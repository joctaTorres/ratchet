Feature: the telemetry module manages the anonymous id and lifecycle safely
  As a maintainer holding ratchet to the testing standard
  I want src/telemetry/index.ts's anonymous-id and lifecycle paths under test
  So that id caching, persistence, and reuse are proven beyond the neutralized stubs

  # test/telemetry/index.test.ts today only proves the neutralized surface
  # (isTelemetryEnabled always false, no client constructed, no notice shown).
  # The exported getOrCreateAnonymousId is reachable and uncovered: it lazily
  # generates a UUID, persists it through updateTelemetryConfig, caches it on the
  # module, loads a pre-existing id from config, and returns the cached value on a
  # second call. These scenarios drive those branches over an isolated config dir
  # (XDG_CONFIG_HOME pointed at a tmpdir under os.tmpdir(), removed in afterEach,
  # vi.resetModules between cases to reset the module-level cache) per the testing
  # standard's fixture-isolation rule.

  Background:
    Given XDG_CONFIG_HOME points at a fresh tmpdir under os.tmpdir()
    And posthog-node is mocked and the tmpdir is removed in afterEach
    And vi.resetModules is used so the module-level id cache does not leak between tests

  Scenario: a first call generates and persists a new anonymous id
    Given no anonymous id exists in the config yet
    When getOrCreateAnonymousId is awaited
    Then it returns a non-empty UUID string
    And the same id is written into the telemetry config on disk

  Scenario: an existing anonymous id is loaded from config rather than regenerated
    Given the telemetry config already stores an anonymous id
    When getOrCreateAnonymousId is awaited in a freshly imported module
    Then it returns the id already stored in config

  Scenario: the anonymous id is cached after the first call
    Given getOrCreateAnonymousId has been awaited once
    When it is awaited a second time in the same module instance
    Then it returns the identical id without re-reading config

  Scenario: shutdown is a no-op safe to call when no client was ever created
    Given telemetry is neutralized so no PostHog client exists
    When shutdown is awaited
    Then it resolves without throwing
