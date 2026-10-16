/** Host-side tool protocol. None of these objects is serialized into model prompts. */
export class ToolContext {
  #session = null;
  constructor({ backend, session = null }) {
    if (!backend || typeof backend !== 'object') throw new TypeError('ToolContext requires a backend');
    Object.defineProperty(this, 'backend', { value: backend, enumerable: false });
    this.bindSession(session);
  }
  bindSession(session) {
    if (session !== null && typeof session !== 'object') throw new TypeError('Invalid tool session');
    this.#session = session;
  }
  get session() { return this.#session; }
  get workspace() { return this.backend.workspace; }
  get signal() { return this.backend.signal; }
  get ledger() { return this.backend.ledger; }
  get memory() { return this.backend.contextMemory; }
  get approveCommand() { return this.backend.approveCommand; }
}

export class ToolSpec {
  constructor({ name, definition, execute, validateInput, mutatesWorkspace = false,
    validatesSource = () => false, commandTiming = false, phase = 'locate' }) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) throw new TypeError('Invalid tool name');
    if (typeof execute !== 'function') throw new TypeError('ToolSpec requires an executor');
    if (typeof definition !== 'function' && (!definition || definition.name !== name)) throw new TypeError('Invalid tool definition');
    if (validateInput !== undefined && typeof validateInput !== 'function') throw new TypeError('Invalid input validator');
    if (typeof validatesSource !== 'function' || !['locate', 'edit', 'verify'].includes(phase)) throw new TypeError('Invalid tool effects');
    Object.assign(this, { name, definition, execute, validateInput, mutatesWorkspace: Boolean(mutatesWorkspace),
      validatesSource, commandTiming: Boolean(commandTiming), phase });
    Object.freeze(this);
  }
  modelDefinition(context) {
    const definition = typeof this.definition === 'function' ? this.definition(context) : this.definition;
    if (definition !== undefined && definition.name !== this.name) throw new Error('Tool definition name mismatch');
    return definition;
  }
}

export class ToolService {
  #specs = new Map();
  #selectDefinitions;
  constructor({ context, specs = [], selectDefinitions } = {}) {
    if (!(context instanceof ToolContext)) throw new TypeError('ToolService requires ToolContext');
    if (selectDefinitions !== undefined && typeof selectDefinitions !== 'function') throw new TypeError('Invalid definition selector');
    Object.defineProperty(this, 'context', { value: context });
    this.#selectDefinitions = selectDefinitions;
    for (const spec of specs) this.register(spec);
  }
  register(spec) {
    if (!(spec instanceof ToolSpec)) throw new TypeError('Register a ToolSpec');
    if (this.#specs.has(spec.name)) throw new Error(`Tool already registered: ${spec.name}`);
    this.#specs.set(spec.name, spec); return this;
  }
  registeredNames() { return [...this.#specs.keys()]; }
  spec(name) { return this.#specs.get(name); }
  definitions(options) {
    const specs = this.#selectDefinitions ? this.#selectDefinitions(this.context, options).map(name => {
      const spec = this.#specs.get(name);
      if (!spec) throw new Error(`Unregistered tool in definition selection: ${name}`);
      return spec;
    }) : [...this.#specs.values()];
    return specs.map(spec => spec.modelDefinition(this.context)).filter(Boolean);
  }
  effects(name, input) {
    const spec = this.#specs.get(name);
    return { mutatesWorkspace: spec?.mutatesWorkspace ?? false, validatesSource: Boolean(spec?.validatesSource(input, this.context)),
      commandTiming: spec?.commandTiming ?? false, phase: spec?.phase ?? 'locate' };
  }
  async execute(name, input) {
    const spec = this.#specs.get(name);
    if (!spec) throw new Error(`Unknown tool: ${name}`);
    this.context.signal?.throwIfAborted();
    if (spec.validateInput) {
      await spec.validateInput(input, this.context);
      this.context.signal?.throwIfAborted();
    }
    // No Promise.race timeout: never report an operation finished while its writes continue.
    // Backend validation, authorization, deadlines and evidence checks remain authoritative.
    return spec.execute(this.context, input);
  }
}
