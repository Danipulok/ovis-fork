import type { CompositionEvent, FormEvent } from "react";

import { typedPairCode } from "../../shared/relay-pair-code.ts";

/**
 * The `onInput` of a field a pairing code is typed in. It reformats only while typing at the end, so a caret moved back
 * stays where it was, and never during a keyboard's composition, whose word the field would otherwise get twice.
 */
export function typePairCode(event: FormEvent<HTMLInputElement>): void {
  const field = event.currentTarget, input = event.nativeEvent as InputEvent;
  if (input.isComposing || field.selectionStart !== field.value.length) return;
  field.value = typedPairCode(field.value, input.inputType?.startsWith("delete") ?? false);
}

/** The same field's `onCompositionEnd`: Chrome fires no input event after a composed word is committed. */
export function endPairCodeComposition(event: CompositionEvent<HTMLInputElement>): void {
  const field = event.currentTarget;
  if (field.selectionStart === field.value.length) field.value = typedPairCode(field.value, false);
}
