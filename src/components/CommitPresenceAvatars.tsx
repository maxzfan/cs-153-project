import { usePresence } from '@/contexts/PresenceContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  commitId: string;
}

export function CommitPresenceAvatars({ commitId }: Props) {
  const { onlineUsers, myUserId } = usePresence();

  const watchers = onlineUsers.filter(
    (u) => u.currentCommitId === commitId && u.userId !== myUserId
  );

  if (watchers.length === 0) return null;

  return (
    <div className="flex items-center -space-x-1">
      {watchers.slice(0, 3).map((u) => (
        <Tooltip key={u.userId}>
          <TooltipTrigger asChild>
            <div
              className="w-5 h-5 rounded-full border border-background flex items-center justify-center text-detail font-bold text-white shrink-0 cursor-default"
              style={{ backgroundColor: u.color }}
            >
              {(u.displayName[0] ?? '?').toUpperCase()}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p className="font-medium">{u.displayName}</p>
            {u.statusMessage && (
              <p className="text-muted-foreground">{u.statusMessage}</p>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      {watchers.length > 3 && (
        <div className="w-5 h-5 rounded-full border border-background bg-muted flex items-center justify-center text-detail text-muted-foreground font-bold">
          +{watchers.length - 3}
        </div>
      )}
    </div>
  );
}
