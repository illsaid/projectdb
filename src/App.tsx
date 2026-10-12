import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Patcher } from '@/components/Patcher';
import { DriftScreen } from '@/components/drift/DriftScreen';
import type { PatchFile } from '@/patch/types';

type View = { name: 'drift' } | { name: 'patcher'; incoming: PatchFile | null; key: number };

export default function App({ resumeAudio = false }: { resumeAudio?: boolean }) {
  const [view, setView] = useState<View>({ name: 'drift' });

  if (view.name === 'patcher') {
    return (
      <ReactFlowProvider key={view.key}>
        <Patcher incoming={view.incoming} onHome={() => setView({ name: 'drift' })} />
      </ReactFlowProvider>
    );
  }
  return <DriftScreen resumeAudio={resumeAudio} onOpenPatcher={(incoming) => setView({ name: 'patcher', incoming, key: Date.now() })} />;
}
