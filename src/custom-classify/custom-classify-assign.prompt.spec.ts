import { buildCustomAssignMessages } from './custom-classify-assign.prompt';

const LABELS = [
  { label: 'transactional', description: 'ready to buy' },
  { label: 'informational', description: 'researching' },
];

describe('buildCustomAssignMessages (T12.8 / FR-34 prompt)', () => {
  it('returns a system message then a user message', () => {
    const msgs = buildCustomAssignMessages(LABELS, ['a', 'b']);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('renders each confirmed label with its description in the system taxonomy', () => {
    const [system] = buildCustomAssignMessages(LABELS, []);
    expect(system.content).toContain('transactional: ready to buy');
    expect(system.content).toContain('informational: researching');
  });

  it('embeds the keywords JSON in the user message', () => {
    const [, user] = buildCustomAssignMessages(LABELS, ['buy shoes', 'shoe review']);
    expect(user.content).toContain(JSON.stringify(['buy shoes', 'shoe review']));
  });

  it('states the single-label + results=inputs rules and the use-only constraint', () => {
    const [system] = buildCustomAssignMessages(LABELS, []);
    expect(system.content).toContain('EXACTLY ONE label');
    expect(system.content.toLowerCase()).toContain('equal the number of input');
    expect(system.content.toLowerCase()).toContain('never invent');
  });

  it('frames the taxonomy as categories only, never as executable commands (S19 injection isolation)', () => {
    const [system] = buildCustomAssignMessages(LABELS, []);
    expect(system.content.toLowerCase()).toContain('never as instructions');
  });
});
