import { useModel } from "@/contexts/ModelContext";
import { UserMenu } from "@/components/Auth";
import { Settings } from "lucide-react";
import { Link } from "react-router-dom";

export const TitleBar = () => {
  const { currentFile, fileName } = useModel();

  return (
    <div className="h-11 bg-panel-header border-b border-panel-border flex items-center px-4 select-none" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>

      {/* Left spacer for native traffic lights */}
      <div className="w-16" />

      {/* title and project info */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm font-medium text-muted-foreground">0studio</span>
        {currentFile && fileName ? (
          <>
            <span className="text-xs text-muted-foreground/60 ml-2">—</span>
            <span className="text-sm text-foreground ml-2">{fileName}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground/60 ml-2">No model open</span>
        )}
      </div>

      {/* Right side - User menu + Settings icon */}
      <div className="min-w-[5rem] flex items-center justify-end gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <UserMenu />
        <Link
          to="/settings"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};
