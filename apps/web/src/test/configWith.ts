import { type AppConfig, type AppConfigInput, validateAppConfig } from '@ezd/core';

/** A configuration with `input` over the defaults, for a test. Throws if it is not valid. */
export function configWith(input: AppConfigInput): AppConfig {
  const checked = validateAppConfig(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.error));
  return checked.value;
}
