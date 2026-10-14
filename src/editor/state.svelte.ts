import type { Normalised } from '../core/parse';
import type { Inventory } from '../core/parse/inventory';
import type { Sandbox } from './sandbox';

// The editor's state before there is a spec (M3). Large values are raw:
// deep reactivity over a 20,000-node inventory would cost more than the pipeline.
class EditorState {
  status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');
  error = $state('');
  fileName = $state('');
  originalBytes = $state(0);
  result = $state.raw<Normalised | undefined>(undefined);
  sandbox = $state.raw<Sandbox | undefined>(undefined);
  inventory = $state.raw<Inventory | undefined>(undefined);
}

export const editor = new EditorState();
