const { withAppBuildGradle } = require("expo/config-plugins");

// Release signing comes from Gradle properties (~/.gradle/gradle.properties)
// or environment variables, never from the repository. Without them a release
// build falls back to the debug key with a loud warning; pass
// -PjingkanRequireReleaseKey=true to fail instead (for builds you will keep).
const HEADER = `// jingkan: release signing (plugins/withReleaseSigning.js)
def jingkanProp = { String name -> findProperty(name) ?: System.getenv(name) }
def jingkanSigning = [
    storeFile    : jingkanProp('JINGKAN_UPLOAD_STORE_FILE'),
    storePassword: jingkanProp('JINGKAN_UPLOAD_STORE_PASSWORD'),
    keyAlias     : jingkanProp('JINGKAN_UPLOAD_KEY_ALIAS'),
    keyPassword  : jingkanProp('JINGKAN_UPLOAD_KEY_PASSWORD'),
]
def jingkanHasReleaseKey = jingkanSigning.values().every { it }
`;
const RELEASE_CONFIG = `
        if (jingkanHasReleaseKey) {
            release {
                storeFile file(jingkanSigning.storeFile)
                storePassword jingkanSigning.storePassword
                keyAlias jingkanSigning.keyAlias
                keyPassword jingkanSigning.keyPassword
            }
        }`;
const RELEASE_SELECT = `if (jingkanHasReleaseKey) {
                signingConfig signingConfigs.release
            } else if ((findProperty('jingkanRequireReleaseKey') ?: 'false').toBoolean()) {
                throw new GradleException("Release key required: set JINGKAN_UPLOAD_STORE_FILE, JINGKAN_UPLOAD_STORE_PASSWORD, JINGKAN_UPLOAD_KEY_ALIAS and JINGKAN_UPLOAD_KEY_PASSWORD (see scripts/create-release-keystore.sh).")
            } else {
                logger.warn("jingkan: no release key configured; this release APK is signed with the DEBUG key (testing only, cannot upgrade a release-signed install).")
                signingConfig signingConfigs.debug
            }`;

function apply(contents) {
  if (contents.includes("jingkan: release signing")) return contents;
  const androidBlock = contents.indexOf("\nandroid {");
  const debugConfig = /(signingConfigs \{\s*debug \{[^}]*\})/;
  const releaseSigning =
    /(release \{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/;
  if (
    androidBlock < 0 ||
    !debugConfig.test(contents) ||
    !releaseSigning.test(contents)
  )
    throw new Error(
      "withReleaseSigning: app/build.gradle layout changed; update the plugin.",
    );
  return (
    contents.slice(0, androidBlock + 1) +
    HEADER +
    contents.slice(androidBlock + 1)
  )
    .replace(debugConfig, `$1${RELEASE_CONFIG}`)
    .replace(releaseSigning, `$1${RELEASE_SELECT}`);
}

module.exports = (config) =>
  withAppBuildGradle(config, (config) => {
    config.modResults.contents = apply(config.modResults.contents);
    return config;
  });
module.exports.apply = apply;
