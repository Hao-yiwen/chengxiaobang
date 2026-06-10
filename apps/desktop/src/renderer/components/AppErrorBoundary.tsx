import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error?: Error;
}

/**
 * Last line of defense: a render crash anywhere below would otherwise unmount
 * the whole tree and leave a blank (black, in dark mode) window. Show the
 * error and offer a reload instead.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[renderer] 界面渲染崩溃:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-8 text-foreground">
        <h1 className="text-lg font-semibold">界面出错了</h1>
        <pre className="max-h-[40vh] max-w-[640px] overflow-auto whitespace-pre-wrap break-words rounded-xl border bg-muted px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {this.state.error.stack ?? this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          重新加载
        </button>
      </div>
    );
  }
}
