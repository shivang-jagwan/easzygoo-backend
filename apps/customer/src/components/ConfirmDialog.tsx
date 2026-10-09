import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** For render harnesses; the two buttons need to be findable apart. */
  confirmTestID?: string;
  cancelTestID?: string;
}

/**
 * A themed yes/no dialog. React Native's own Alert is drawn by the OS and
 * ignores our tokens, so decisions that matter get this instead.
 *
 * Deliberately has no `visible` prop: render it conditionally, so a closed
 * dialog is genuinely absent from the tree rather than present-but-hidden.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmTestID,
  cancelTestID,
}: ConfirmDialogProps) {
  const { colors } = useTheme();

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          style={[styles.dialog, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

          <View style={styles.actions}>
            <Pressable
              testID={cancelTestID}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.text }]}>{cancelLabel}</Text>
            </Pressable>

            <Pressable
              testID={confirmTestID}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.primaryText, { color: colors.buttonText }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dialog: { width: '100%', borderRadius: 14, borderWidth: 1, padding: 20, gap: 10 },
  title: { fontSize: 17, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 8 },
  primaryButton: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 8 },
  primaryText: { fontSize: 15, fontWeight: '600' },
  secondaryButton: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 8, borderWidth: 1 },
  secondaryText: { fontSize: 15, fontWeight: '600' },
});
