import type { Page } from '@playwright/test';

/**
 * An accessibility audit run in the page, in place of axe-core (MPL-2.0, which the license
 * allowlist rules out). It checks what can be checked from the DOM: the page language, a
 * top-level heading, a name for every control, link and image, unique ids, and WCAG AA
 * text contrast. Returns one line per problem.
 */
export function audit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const describe = (el: Element) =>
      `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}> "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    const hidden = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        if (node.getAttribute('aria-hidden') === 'true') return true;
      }
      return false;
    };
    const visuallyHidden = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)')
          return true;
        if (node.classList.contains('sr-only')) return true;
      }
      return false;
    };
    const textOf = (el: Element): string => {
      const labelledby = el.getAttribute('aria-labelledby');
      const fromIds = labelledby
        ? labelledby
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        : '';
      return [el.getAttribute('aria-label'), fromIds, el.getAttribute('title'), el.textContent]
        .filter(Boolean)
        .join(' ')
        .trim();
    };

    if (!document.documentElement.lang) problems.push('<html> has no lang');
    if (document.querySelectorAll('h1').length === 0) problems.push('No <h1> on the page');

    const ids = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((el) => ids.set(el.id, (ids.get(el.id) ?? 0) + 1));
    for (const [id, count] of ids) if (count > 1) problems.push(`Duplicate id "${id}" (${count})`);

    for (const el of document.querySelectorAll('input, select, textarea')) {
      const input = el as HTMLInputElement;
      if (input.type === 'hidden' || hidden(el)) continue;
      const labelled =
        textOf(el) !== (el.textContent ?? '').trim() ||
        (input.labels && input.labels.length > 0) ||
        el.getAttribute('placeholder');
      if (!labelled || (input.labels?.length === 0 && !textOf(el))) {
        problems.push(`Control without a label: ${describe(el)}`);
      }
    }
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      if (hidden(el)) continue;
      if (!textOf(el) && !el.querySelector('img[alt]:not([alt=""]), svg[aria-label]')) {
        problems.push(`Button or link without a name: ${describe(el)}`);
      }
    }
    for (const el of document.querySelectorAll('img')) {
      if (!el.hasAttribute('alt')) problems.push(`Image without alt: ${el.getAttribute('src')}`);
    }

    // Contrast of each element's own text against the first opaque background behind it.
    // Tailwind's palette is in OKLCH, which the browser reports as it is.
    const fromOklch = (l: number, c: number, h: number) => {
      const a = c * Math.cos((h * Math.PI) / 180);
      const b = c * Math.sin((h * Math.PI) / 180);
      const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const linear = [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
      ];
      const [r, g, bl] = linear.map((v) => {
        const x = Math.min(1, Math.max(0, v));
        return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
      });
      return { r: r!, g: g!, b: bl! };
    };
    const parse = (color: string) => {
      const rgb = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/.exec(color);
      if (rgb)
        return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a: rgb[4] === undefined ? 1 : +rgb[4] };
      const ok = /oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)(%?))?\)/.exec(color);
      if (!ok) return null;
      const l = ok[2] ? +ok[1]! / 100 : +ok[1]!;
      const alpha = ok[5] === undefined ? 1 : ok[6] ? +ok[5] / 100 : +ok[5];
      return { ...fromOklch(l, +ok[3]!, +ok[4]!), a: alpha };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const background = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a >= 0.95) return bg;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !(node.textContent ?? '').trim()) continue;
      seen.add(el);
      if (hidden(el) || visuallyHidden(el) || el.closest('[disabled], [aria-disabled="true"]'))
        continue;
      if (el.closest('canvas, svg, option')) continue;
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = background(el);
      // Blend a translucent text colour onto its background.
      const blended = {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
      };
      const [light, dark] = [luminance(blended), luminance(bg)].sort((a, b) => b - a);
      const ratio = (light! + 0.05) / (dark! + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        problems.push(
          `Contrast ${ratio.toFixed(2)}:1 for ${describe(el)} (${style.color} on rgb(${bg.r}, ${bg.g}, ${bg.b}))`,
        );
      }
    }
    // A dialog has a name and a description, so a screen reader says what it is and what it asks.
    for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      if (hidden(el)) continue;
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!named) problems.push(`Dialog without a title: ${describe(el)}`);
      if (!el.getAttribute('aria-describedby'))
        problems.push(`Dialog without a description: ${describe(el)}`);
    }

    // On a touch screen, a control is at least 44 px in both directions. Links inside a line of
    // text are exempt, as in WCAG 2.2's target-size rule.
    if (matchMedia('(pointer: coarse)').matches) {
      const controls =
        'button, [role="button"], [role="tab"], input:not([type="hidden"]), select, textarea';
      for (const el of document.querySelectorAll(`${controls}, a[href]`)) {
        if (hidden(el) || visuallyHidden(el) || el.closest('canvas')) continue;
        if (el.matches('a[href]') && el.closest('p, li > span, td')) continue;
        if (el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label'))
          continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.width < 44 || box.height < 44)
          problems.push(
            `Target ${Math.round(box.width)}x${Math.round(box.height)} px: ${describe(el)}`,
          );
      }
    }
    return problems;
  });
}

/**
 * Tabs through the page and checks that whatever has focus shows it: an outline or a ring (box
 * shadow). Returns one line per control that does not.
 */
export async function auditFocus(page: Page, presses = 25): Promise<string[]> {
  const problems: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Tab');
    const problem = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const ring = style.boxShadow !== 'none' && style.boxShadow !== '';
      const border = el.matches('input, select, textarea');
      if (outline || ring || border) return null;
      return `<${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    });
    if (problem) problems.push(`No visible focus: ${problem}`);
  }
  return problems;
}
