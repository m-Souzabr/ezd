import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

import { api, type LLMSettings, type LLMSettingsUpdate } from '../api/client';
import { llmSettingsKey } from '../api/keys';
import { useSession } from '../auth/session';
import { BUTTON } from '../editor/panels/fields';
import { fieldErrors, formatDate } from './format';
import { FormError, Page, PRIMARY, TextField } from './ui';

const SOURCE_TEXT: Record<LLMSettings['key_source'], string> = {
  settings: 'A key entered here is in use',
  environment: 'The key from the server environment is in use',
  none: 'No key yet: the assistant is off',
};

type Models = { router: string; default: string; escalation: string };

/**
 * The assistant's settings for the whole site: the vendor API key and the three models.
 * Staff only. The key is sent once and never shown again; the server keeps it encrypted.
 */
function SettingsForm({ settings }: { settings: LLMSettings }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [models, setModels] = useState<Models>(settings.models);
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: LLMSettingsUpdate) => api.updateLLMSettings(body),
    onSuccess: (next, body) => {
      queryClient.setQueryData(llmSettingsKey, next);
      setKey('');
      setSaved(body.api_key === '' ? 'The key was removed.' : 'Saved.');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    save.mutate({
      ...(key.trim() && { api_key: key.trim() }),
      router_model: models.router,
      default_model: models.default,
      escalation_model: models.escalation,
    });
  };

  const model = (name: keyof Models, label: string) => (
    <TextField
      label={`${label} (default ${settings.default_models[name]})`}
      value={models[name]}
      onChange={(value) => setModels((current) => ({ ...current, [name]: value }))}
      errors={fieldErrors(save.error, `${name}_model`)}
      required={false}
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-700" data-testid="key-status">
        {SOURCE_TEXT[settings.key_source]}
        {settings.api_key_last4 && <> (ending in {settings.api_key_last4})</>}. Vendor:{' '}
        {settings.vendor}.
      </p>
      <TextField
        label={settings.api_key_last4 ? 'Replace the API key' : 'API key'}
        type="password"
        autoComplete="off"
        value={key}
        onChange={setKey}
        errors={fieldErrors(save.error, 'api_key')}
        required={false}
      />
      <p className="-mt-2 text-xs text-slate-500">
        It is stored encrypted on the server and never shown again, here or anywhere else.
      </p>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-slate-700">Models</legend>
        {model('router', 'Routing and simple edits')}
        {model('default', 'Other edits')}
        {model('escalation', 'Last retry')}
      </fieldset>
      <FormError error={save.error} fields={['api_key', 'router_model', 'default_model']} />
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          {saved}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={save.isPending}>
          Save
        </button>
        {settings.key_source === 'settings' && (
          <button
            type="button"
            className={BUTTON}
            disabled={save.isPending}
            onClick={() => {
              setSaved(null);
              save.mutate({ api_key: '' });
            }}
          >
            Remove key
          </button>
        )}
      </div>
      {settings.updated_at && (
        <p className="text-xs text-slate-500">Last changed {formatDate(settings.updated_at)}.</p>
      )}
    </form>
  );
}

export function AISettingsPage() {
  const user = useSession();
  const staff = user?.is_staff === true;
  const settings = useQuery({
    queryKey: llmSettingsKey,
    queryFn: api.getLLMSettings,
    enabled: staff,
  });
  return (
    <Page title="AI settings">
      {!staff ? (
        <p className="text-sm text-slate-700">Only an administrator can change these settings.</p>
      ) : settings.data ? (
        <SettingsForm settings={settings.data} />
      ) : (
        <FormError error={settings.error} />
      )}
    </Page>
  );
}
