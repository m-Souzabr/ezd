import { type Catalog, getEntry, proposeCountertops } from '../catalog/index.js';
import { applyCommand, type Command, type CommandOf } from '../commands/index.js';
import type { DesignDocument, Id, Item, Opening, Placement } from '../document/index.js';
import { toIssues } from '../document/index.js';
import { describeIssues } from '../issues.js';
import { err, ok, type Result } from '../result.js';
import { validateCommand, type Violation, wallLabel } from '../rules/index.js';
import { IN, type Len } from '../units/index.js';
import { describeProposal } from './describe.js';
import {
  type ToolArgs,
  ToolArgsSchemas,
  type ToolCall,
  type ToolName,
  TOOL_NAMES,
} from './tools.js';

// Turns the model's tool calls into one `batch` command. Every message here is worded for
// the model to act on: it names the tool call, uses aliases and wall labels, never ids,
// and says what to use instead.

export type ProposalError = {
  /** Which tool call, from 0. */
  toolIndex: number;
  tool: string;
  message: string;
};

export type ProposalOptions = {
  /** Makes the id of each new entity. Defaults to `ai-item-01`, `ai-opening-01` and so on. */
  newId?: (prefix: 'item' | 'opening') => Id;
};

export const PROPOSAL_LABEL = 'Assistant edit';

type Converted = Result<Command[], string>;

/** The wall with the label, as `wallLabel` names it. */
function wallIdOf(doc: DesignDocument, label: string): Result<Id, string> {
  const wall = doc.room.walls.find((candidate) => wallLabel(doc, candidate.id) === label);
  if (wall) return ok(wall.id);
  const labels = doc.room.walls.map((candidate) => wallLabel(doc, candidate.id));
  return err(
    labels.length === 0
      ? `There is no wall ${label}: the room has no walls.`
      : `There is no wall ${label}. The walls are ${labels.join(', ')}.`,
  );
}

/** Inches to a `Len`. The tool schemas already require a multiple of 1/16 in. */
const len = (inches: number): Len => Math.round(inches * IN);

function placementOf(
  doc: DesignDocument,
  args: {
    wall?: string | undefined;
    offsetIn?: number | undefined;
    free?: ToolArgs<'add_item'>['free'];
  },
): Result<Placement, string> {
  const onWall = args.wall !== undefined || args.offsetIn !== undefined;
  if (onWall && args.free) return err('Give either wall and offsetIn, or free, not both.');
  if (args.free) {
    return ok({
      type: 'free',
      x: len(args.free.xIn),
      y: len(args.free.yIn),
      rotation: args.free.rotation,
    });
  }
  if (args.wall === undefined || args.offsetIn === undefined) {
    return err('Give both wall and offsetIn, or free.');
  }
  const wallId = wallIdOf(doc, args.wall);
  if (!wallId.ok) return wallId;
  return ok({ type: 'wall', wallId: wallId.value, offset: len(args.offsetIn) });
}

/** Rewrites every id in a core message as the alias or wall label the model knows it by. */
function inModelTerms(doc: DesignDocument, aliases: Record<string, Id>, message: string): string {
  const names = new Map<Id, string>(Object.entries(aliases).map(([alias, id]) => [id, alias]));
  for (const wall of doc.room.walls) names.set(wall.id, `wall ${wallLabel(doc, wall.id)}`);
  let text = message;
  for (const [id, name] of names) text = text.split(`"${id}"`).join(name).split(id).join(name);
  return text;
}

export function proposalToCommands(
  toolCalls: readonly ToolCall[],
  aliases: Record<string, Id>,
  doc: DesignDocument,
  catalog: Catalog,
  options: ProposalOptions = {},
): Result<CommandOf<'batch'>, ProposalError[]> {
  const used = new Set<Id>(
    [doc.room.walls, doc.room.openings, doc.items, doc.countertops].flatMap((list) =>
      list.map((entity) => entity.id),
    ),
  );
  const serials = new Map<string, number>();
  const newId =
    options.newId ??
    ((prefix: string): Id => {
      let id: Id;
      let serial = serials.get(prefix) ?? 0;
      do {
        serial += 1;
        id = `ai-${prefix}-${String(serial).padStart(2, '0')}`;
      } while (used.has(id));
      serials.set(prefix, serial);
      used.add(id);
      return id;
    });

  // Each call is converted against the document as the calls before it left it, so
  // `generate_countertops` covers cabinets added earlier in the same proposal.
  let current = doc;
  const commands: Command[] = [];
  const errors: ProposalError[] = [];
  const resolve = (alias: string, kind: 'item' | 'opening'): Result<Id, string> => {
    const id = aliases[alias];
    const exists =
      id !== undefined &&
      (kind === 'item' ? current.items : current.room.openings).some((entity) => entity.id === id);
    return exists ? ok(id) : err(`There is no ${kind} ${alias} in the design.`);
  };

  const convert = (name: ToolName, input: unknown): Converted => {
    switch (name) {
      case 'add_item': {
        const args = input as ToolArgs<'add_item'>;
        const entry = getEntry(catalog, args.catalogId);
        if (!entry) {
          return err(`The catalog has no entry "${args.catalogId}". Use an id from the catalog.`);
        }
        const placement = placementOf(current, args);
        if (!placement.ok) return placement;
        const defaults = Object.fromEntries(entry.options.map((def) => [def.key, def.default]));
        const item: Item = {
          id: newId('item'),
          catalogId: entry.id,
          kind: entry.kind,
          width: len(args.widthIn),
          height: args.heightIn === undefined ? entry.defaultSize.height : len(args.heightIn),
          depth: args.depthIn === undefined ? entry.defaultSize.depth : len(args.depthIn),
          elevation:
            args.elevationIn === undefined ? entry.defaultElevation : len(args.elevationIn),
          placement: placement.value,
          options: { ...defaults, ...args.options },
        };
        return ok([{ type: 'item.add', item }]);
      }
      case 'move_item': {
        const args = input as ToolArgs<'move_item'>;
        const id = resolve(args.item, 'item');
        if (!id.ok) return id;
        const item = current.items.find((candidate) => candidate.id === id.value)!;
        const keepsPlace = args.wall === undefined && args.offsetIn === undefined && !args.free;
        let placement: Result<Placement, string>;
        if (keepsPlace) {
          if (args.elevationIn === undefined) return err('Give a new position or elevationIn.');
          placement = ok(item.placement);
        } else if (
          args.offsetIn !== undefined &&
          args.wall === undefined &&
          item.placement.type === 'wall'
        ) {
          // A move along the wall the item is already on.
          placement = ok({ ...item.placement, offset: len(args.offsetIn) });
        } else {
          placement = placementOf(current, args);
        }
        if (!placement.ok) return placement;
        return ok([
          {
            type: 'item.move',
            id: id.value,
            placement: placement.value,
            ...(args.elevationIn !== undefined && { elevation: len(args.elevationIn) }),
          },
        ]);
      }
      case 'resize_item': {
        const args = input as ToolArgs<'resize_item'>;
        const id = resolve(args.item, 'item');
        if (!id.ok) return id;
        if (
          args.widthIn === undefined &&
          args.heightIn === undefined &&
          args.depthIn === undefined
        ) {
          return err('Give widthIn, heightIn or depthIn.');
        }
        return ok([
          {
            type: 'item.resize',
            id: id.value,
            ...(args.widthIn !== undefined && { width: len(args.widthIn) }),
            ...(args.heightIn !== undefined && { height: len(args.heightIn) }),
            ...(args.depthIn !== undefined && { depth: len(args.depthIn) }),
          },
        ]);
      }
      case 'set_item_options': {
        const args = input as ToolArgs<'set_item_options'>;
        const id = resolve(args.item, 'item');
        if (!id.ok) return id;
        if (args.options === undefined && args.finishId === undefined) {
          return err('Give options or finishId.');
        }
        if (args.finishId !== undefined) {
          const finish = catalog.finishes.find((candidate) => candidate.id === args.finishId);
          if (finish?.target !== 'cabinet') {
            return err(`"${args.finishId}" is not a cabinet finish. Use a cabinet finish id.`);
          }
        }
        return ok([
          {
            type: 'item.setOptions',
            id: id.value,
            options: args.options ?? {},
            ...(args.finishId !== undefined && { finishId: args.finishId }),
          },
        ]);
      }
      case 'remove_item': {
        const id = resolve((input as ToolArgs<'remove_item'>).item, 'item');
        return id.ok ? ok([{ type: 'item.remove', id: id.value }]) : id;
      }
      case 'add_opening': {
        const args = input as ToolArgs<'add_opening'>;
        const wallId = wallIdOf(current, args.wall);
        if (!wallId.ok) return wallId;
        if (args.kind === 'window' && args.sillIn === undefined)
          return err('A window needs sillIn.');
        const opening: Opening = {
          id: newId('opening'),
          wallId: wallId.value,
          kind: args.kind,
          offset: len(args.offsetIn),
          width: len(args.widthIn),
          height: len(args.heightIn),
          sillHeight: args.sillIn === undefined ? 0 : len(args.sillIn),
          ...(args.swing && { swing: args.swing }),
        };
        return ok([{ type: 'opening.add', opening }]);
      }
      case 'update_opening': {
        const args = input as ToolArgs<'update_opening'>;
        const id = resolve(args.opening, 'opening');
        if (!id.ok) return id;
        let wallId: Id | undefined;
        if (args.wall !== undefined) {
          const found = wallIdOf(current, args.wall);
          if (!found.ok) return found;
          wallId = found.value;
        }
        const patch: CommandOf<'opening.update'>['patch'] = {
          ...(wallId !== undefined && { wallId }),
          ...(args.kind !== undefined && { kind: args.kind }),
          ...(args.offsetIn !== undefined && { offset: len(args.offsetIn) }),
          ...(args.widthIn !== undefined && { width: len(args.widthIn) }),
          ...(args.heightIn !== undefined && { height: len(args.heightIn) }),
          ...(args.sillIn !== undefined && { sillHeight: len(args.sillIn) }),
          ...(args.swing !== undefined && { swing: args.swing }),
        };
        // A door or passage has no sill and only a door has a swing, so a change of kind
        // clears what the new kind cannot have.
        if (args.kind !== undefined && args.kind !== 'window' && args.sillIn === undefined) {
          patch.sillHeight = 0;
        }
        if (args.kind !== undefined && args.kind !== 'door' && args.swing === undefined) {
          patch.swing = null;
        }
        if (Object.keys(patch).length === 0) return err('Give at least one field to change.');
        return ok([{ type: 'opening.update', id: id.value, patch }]);
      }
      case 'remove_opening': {
        const id = resolve((input as ToolArgs<'remove_opening'>).opening, 'opening');
        return id.ok ? ok([{ type: 'opening.remove', id: id.value }]) : id;
      }
      case 'set_finish': {
        const args = input as ToolArgs<'set_finish'>;
        const finish = catalog.finishes.find((candidate) => candidate.id === args.finishId);
        if (!finish) return err(`The catalog has no finish "${args.finishId}".`);
        if (finish.target !== args.target) {
          return err(`"${finish.id}" is a ${finish.target} finish, not a ${args.target} finish.`);
        }
        return ok([{ type: 'finish.set', target: args.target, finishId: finish.id }]);
      }
      case 'generate_countertops': {
        const proposed = proposeCountertops(current, catalog);
        return proposed.length > 0
          ? ok(proposed)
          : err('Every run of base cabinets already has a countertop, so there is none to add.');
      }
      case 'ask_user':
        return err('ask_user ends the turn: call it alone, with no other tool.');
    }
  };

  toolCalls.forEach((call, toolIndex) => {
    const fail = (message: string) =>
      errors.push({ toolIndex, tool: call.name, message: inModelTerms(current, aliases, message) });
    if (!(TOOL_NAMES as string[]).includes(call.name)) {
      fail(`There is no tool "${call.name}". Use one of ${TOOL_NAMES.join(', ')}.`);
      return;
    }
    const name = call.name as ToolName;
    const parsed = ToolArgsSchemas[name].safeParse(call.arguments);
    if (!parsed.success) {
      fail(`Invalid arguments: ${describeIssues(toIssues(parsed.error))}`);
      return;
    }
    const converted = convert(name, parsed.data);
    if (!converted.ok) {
      fail(converted.error);
      return;
    }
    let next = current;
    for (const command of converted.value) {
      const applied = applyCommand(next, command, { catalog });
      if (!applied.ok) {
        fail(applied.error.message);
        return;
      }
      next = applied.value.doc;
    }
    current = next;
    commands.push(...converted.value);
  });

  if (errors.length > 0) return err(errors);
  if (commands.length === 0) {
    return err([
      {
        toolIndex: -1,
        tool: '',
        message: 'The proposal has no tool calls that change the design.',
      },
    ]);
  }
  return ok({ type: 'batch', label: PROPOSAL_LABEL, commands });
}

/** A proposal checked against the document, without changing it. */
export type DryRun =
  | {
      ok: true;
      command: CommandOf<'batch'>;
      /** The document the proposal would give. */
      doc: DesignDocument;
      /** The warnings the proposal adds, to show next to Accept. */
      introducedWarnings: Violation[];
      /** One line per change, for the user. */
      changes: string[];
    }
  | { ok: false; errors: ProposalError[] };

/**
 * Converts the tool calls and dry-runs them: the same check the editor and the eval
 * runner use. A proposal that introduces an error-severity violation fails, with one
 * error per violation, so the model can be asked again.
 */
export function dryRunProposal(
  toolCalls: readonly ToolCall[],
  aliases: Record<string, Id>,
  doc: DesignDocument,
  catalog: Catalog,
  options: ProposalOptions = {},
): DryRun {
  const converted = proposalToCommands(toolCalls, aliases, doc, catalog, options);
  if (!converted.ok) return { ok: false, errors: converted.error };
  const checked = validateCommand(doc, catalog, converted.value);
  // `proposalToCommands` applied every command already, so this cannot fail.
  if (!checked.ok) {
    return { ok: false, errors: [{ toolIndex: -1, tool: '', message: checked.error.message }] };
  }
  const { doc: next, introduced } = checked.value;
  const introducedErrors = introduced.filter((violation) => violation.severity === 'error');
  if (introducedErrors.length > 0) {
    return {
      ok: false,
      errors: introducedErrors.map((violation) => ({
        toolIndex: -1,
        tool: '',
        message: `The change would cause this problem: ${inModelTerms(next, aliases, violation.message)}`,
      })),
    };
  }
  return {
    ok: true,
    command: converted.value,
    doc: next,
    introducedWarnings: introduced.filter((violation) => violation.severity === 'warning'),
    changes: describeProposal(doc, next, catalog),
  };
}
