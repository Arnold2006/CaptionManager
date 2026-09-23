import React from 'react';

// Catches render exceptions (e.g. a malformed caption file opened from disk)
// so one bad view can't blank the entire app.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      const { title, onReset } = this.props;
      return (
        <div className="empty">
          <h3>{title || 'Something went wrong'}</h3>
          <p style={{ maxWidth: 420 }}>{String(this.state.error?.message || this.state.error)}</p>
          {onReset && <button className="btn" onClick={() => { this.setState({ error: null }); onReset(); }}>Dismiss</button>}
        </div>
      );
    }
    return this.props.children;
  }
}
