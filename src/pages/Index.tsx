import { TitleBar } from "@/components/TitleBar";
import { VersionControl } from "@/components/VersionControl";
import { ModelViewer } from "@/components/ModelViewer";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useModel } from "@/contexts/ModelContext";

const MainContent = () => {
  const { currentFile } = useModel();
  const hasModel = !!currentFile;

  return (
    <div className="flex-1 p-2 overflow-hidden">
      {hasModel ? (
        <ResizablePanelGroup direction="horizontal" className="h-full overflow-hidden">
          <ResizablePanel defaultSize={38} minSize={28} maxSize={50}>
            <VersionControl />
          </ResizablePanel>
          <ResizableHandle className="w-1 bg-transparent hover:bg-primary/20 transition-colors" />
          <ResizablePanel defaultSize={62} minSize={50}>
            <ModelViewer />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="h-full">
          <ModelViewer />
        </div>
      )}
    </div>
  );
};

const Index = () => (
  <div className="h-screen flex flex-col bg-background overflow-hidden">
    <TitleBar />
    <MainContent />
  </div>
);

export default Index;
