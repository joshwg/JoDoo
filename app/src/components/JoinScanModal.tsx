import React from 'react';
import { parseJoinUrl } from '../shareLinks';
import QrScanModal from './QrScanModal';

interface Props {
  visible: boolean;
  onCancel: () => void;
  /** Called once with the scanned share key; the parent joins and closes. */
  onScanned: (key: string) => void;
}

/** QR scanner for joining a shared list. Accepts any QR that decodes to a
 *  join URL (https or jodoo:// form) or a bare share key. */
export default function JoinScanModal({ visible, onCancel, onScanned }: Props) {
  return (
    <QrScanModal
      visible={visible}
      onCancel={onCancel}
      prompt="Point the camera at a Jodoo share QR code."
      badCodeHint="That QR code is not a Jodoo share link - keep looking."
      onCode={(data) => {
        const parsed = parseJoinUrl(data);
        if (!parsed) return false;
        onScanned(parsed.key);
        return true;
      }}
    />
  );
}
