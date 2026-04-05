interface TypingIndicatorProps {
  typingUsers: Set<string>;
  participantNames: Record<string, string>;
}

export default function TypingIndicator({ typingUsers, participantNames }: TypingIndicatorProps) {
  if (typingUsers.size === 0) return null;

  const names = Array.from(typingUsers).map(
    (id) => participantNames[id]?.split(' ')[0] || 'Someone'
  );

  const text = names.length === 1
    ? `${names[0]} is typing`
    : `${names.join(' and ')} are typing`;

  return (
    <div className="px-4 py-1.5 flex items-center gap-2">
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  );
}
