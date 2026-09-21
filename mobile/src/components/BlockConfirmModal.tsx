import ConfirmModal from '@/components/ConfirmModal';

/**
 * The one "Block @handle?" confirmation, shared by every place a block can
 * start (a post's menu, post detail, a profile, a DM), so the explanation
 * of what a block does can't drift between them. The copy describes what
 * 20260921100000_block_enforcement.sql actually enforces — keep the two in
 * step.
 */
export default function BlockConfirmModal({
  visible,
  handle,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  handle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmModal
      visible={visible}
      title={`Block @${handle}?`}
      body="They won't see your posts, stories or comments, and you won't see theirs. Neither of you can message the other, and you'll stop being friends. They won't be told. You can unblock them later in Settings."
      confirmLabel="Block"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
