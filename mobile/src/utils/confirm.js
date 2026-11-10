import { Alert } from 'react-native';

/** Native confirm dialog for destructive actions. */
export function confirmAction(title, message, onConfirm, confirmText = 'Yes') {
  Alert.alert(title, message, [
    { text: 'Keep', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}
