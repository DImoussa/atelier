import React from 'react';

/**
 * Empêche une erreur d'affichage dans une partie de l'interface de faire tomber toute l'application.
 * La partie concernée est masquée puis réessayée automatiquement.
 */
export class Safe extends React.Component<{ children: React.ReactNode; name?: string; fallback?: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  private timer: any;
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.name || 'interface'}]`, error);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState({ error: null }), 800);
  }
  componentWillUnmount() { clearTimeout(this.timer); }
  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
