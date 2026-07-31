export interface NormalizedProfile {
  readonly id: string;
  readonly displayName: string;
  readonly age?: number;
  readonly tags: readonly string[];
}

export interface ProfileValidationIssue {
  readonly field: "profile" | "id" | "displayName" | "age" | "tags";
  readonly message: string;
}

export type NormalizeProfileResult =
  | { readonly ok: true; readonly profile: NormalizedProfile }
  | { readonly ok: false; readonly issues: readonly ProfileValidationIssue[] };

/**
 * Проверяет недоверенный вход и строит новый профиль.
 *
 * TODO: сузьте unknown небольшими проверками, соберите все ошибки и создайте
 * новый объект, не меняя исходные данные.
 */
export function normalizeProfile(_input: unknown): NormalizeProfileResult {
  throw new Error("TODO: implement normalizeProfile");
}
