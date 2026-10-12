import { useCallback } from 'react';
import { formLook, NEUTRAL_LOOK, type Form, type FormPosition, type SectionLook } from '@/audio/form';

/** A per-frame getter for the visual offsets of the form section currently playing. */
export function useFormLook(form: Form | undefined, position: () => FormPosition | null): () => SectionLook {
  return useCallback(() => {
    const pos = form ? position() : null;
    return form && pos ? formLook(form, pos) : NEUTRAL_LOOK;
  }, [form, position]);
}
