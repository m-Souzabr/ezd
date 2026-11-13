import { describe, expect, it } from 'vitest';

import {
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  HELP_STEPS,
  ITEM_KINDS,
  parseAppConfig,
  validateAppConfig,
} from './index.js';

describe('AppConfigSchema', () => {
  it('fills every default from an empty object', () => {
    const config = AppConfigSchema.parse({});
    expect(config).toEqual(DEFAULT_APP_CONFIG);
    expect(config.panels.properties).toEqual({ visible: true, defaultCollapsed: false });
    expect(Object.values(config.features).every(Boolean)).toBe(true);
    expect(config.viewport).toEqual({ defaultScale: 4, gridStep: 48, minScale: 0.5, maxScale: 40 });
    expect(config.panels.catalog.order).toEqual([...ITEM_KINDS]);
    expect(config.panels.catalog.groups.base).toEqual({ title: 'Base cabinets', visible: true });
    expect(config.help.steps).toEqual(HELP_STEPS);
    expect(config.theme.plan.wall).toBe('#475569');
    expect(config.theme.itemFill.base).toBe('#dbeafe');
  });

  it('keeps a partial input and fills the rest', () => {
    const result = validateAppConfig({
      panels: { properties: { visible: false } },
      toolbar: { tools: { pan: false } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.panels.properties).toEqual({ visible: false, defaultCollapsed: false });
    expect(result.value.toolbar.tools).toEqual({
      select: true,
      wall: true,
      opening: true,
      pan: false,
    });
    expect(result.value.features.assistant).toBe(true);
  });

  it('rejects unknown keys, at any depth', () => {
    for (const input of [
      { nope: 1 },
      { features: { nope: true } },
      { theme: { plan: { x: '#000000' } } },
    ]) {
      const result = validateAppConfig(input);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects invalid colors, and accepts #rrggbb and #rrggbbaa', () => {
    for (const color of ['red', '#fff', '#12345', '#gggggg', 'rgb(0,0,0)', 5]) {
      const result = validateAppConfig({ theme: { plan: { wall: color } } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error[0]?.path).toBe('theme.plan.wall');
    }
    expect(validateAppConfig({ theme: { itemFill: { base: '#AABBCCDD' } } }).ok).toBe(true);
  });

  it('checks the rules across fields', () => {
    const bad = (input: unknown, path: string) => {
      const result = validateAppConfig(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.map((i) => i.path)).toContain(path);
    };
    bad({ toolbar: { tools: { select: false } } }, 'toolbar.tools.select');
    bad({ viewport: { minScale: 10 } }, 'viewport.defaultScale');
    bad({ viewport: { gridStep: 0 } }, 'viewport.gridStep');
    bad({ viewport: { gridStep: 1.5 } }, 'viewport.gridStep');
    bad({ viewport: { gridStep: 1000 } }, 'viewport.gridStep');
    bad({ panels: { catalog: { order: ['base'] } } }, 'panels.catalog.order');
    bad(
      { panels: { catalog: { groups: { base: { title: ' ' } } } } },
      'panels.catalog.groups.base.title',
    );
    bad({ help: { steps: [] } }, 'help.steps');
  });
});

describe('parseAppConfig', () => {
  it('is not valid for input that is not an object', () => {
    for (const input of [null, 3, 'x', []]) expect(parseAppConfig(input).ok).toBe(false);
  });

  it('gives the defaults for an empty object', () => {
    const parsed = parseAppConfig({});
    expect(parsed.ok && parsed.value).toEqual({ config: DEFAULT_APP_CONFIG, ignored: [] });
  });

  it('falls back to the default field by field', () => {
    const parsed = parseAppConfig({
      panels: { properties: { visible: false, defaultCollapsed: 'yes' } },
      features: { quotes: false, unknown: true },
      theme: { plan: { wall: 'red', floor: '#000000' } },
      extra: 1,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { config, ignored } = parsed.value;
    expect(config.panels.properties).toEqual({ visible: false, defaultCollapsed: false });
    expect(config.features.quotes).toBe(false);
    expect(config.theme.plan.wall).toBe(DEFAULT_APP_CONFIG.theme.plan.wall);
    expect(config.theme.plan.floor).toBe('#000000');
    expect(ignored.map((i) => i.path).sort()).toEqual(
      ['', 'features', 'panels.properties.defaultCollapsed', 'theme.plan.wall'].sort(),
    );
  });

  it('drops a whole list when one element is wrong', () => {
    const parsed = parseAppConfig({ help: { steps: [{ title: 'ok', text: 'ok' }, { title: 3 }] } });
    expect(parsed.ok && parsed.value.config.help.steps).toEqual(HELP_STEPS);
  });

  it('drops a section whose rule fails across fields', () => {
    const parsed = parseAppConfig({ viewport: { minScale: 10, defaultScale: 2 } });
    expect(parsed.ok && parsed.value.config.viewport).toEqual(DEFAULT_APP_CONFIG.viewport);
    const tools = parseAppConfig({ toolbar: { tools: { select: false, pan: false } } });
    expect(tools.ok && tools.value.config.toolbar.tools.select).toBe(true);
    expect(tools.ok && tools.value.config.toolbar.tools.pan).toBe(false);
  });
});
