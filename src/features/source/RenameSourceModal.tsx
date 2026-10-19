import React from "react";
import { Modal, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ErrorNotice, Heading } from "../../components/ui";
import type { Source } from "../../domain/types";
import { styles } from "../../theme";

interface RenameProps {
  source: Source | null;
  text: string;
  error?: string;
  onDismissError?: () => void;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function RenameSourceModal(props: RenameProps) {
  return (
    <Modal
      visible={!!props.source}
      animationType="slide"
      onRequestClose={props.onCancel}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Heading title="来源改名" />
          <ErrorNotice message={props.error} onDismiss={props.onDismissError} />
          <TextInput
            accessibilityLabel="来源名称"
            style={styles.input}
            value={props.text}
            onChangeText={props.onChangeText}
            maxLength={100}
          />
          <Button
            label="保存名称"
            disabled={!props.text.trim()}
            onPress={props.onSave}
          />
          <Button label="取消" secondary onPress={props.onCancel} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
