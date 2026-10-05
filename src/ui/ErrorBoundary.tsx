import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown above the message, e.g. "This page". */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so one broken screen cannot blank the whole app.
 * Key it by route so navigating away clears the error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="card mx-auto mt-10 max-w-[520px] p-8 text-center">
        <div className="text-[15px] font-semibold text-ink">
          {this.props.label ?? "This page"} hit a problem
        </div>
        <p className="mt-2 text-[12.5px] text-ink-soft">
          Your saved data is safe. Try again, or reload the app.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
