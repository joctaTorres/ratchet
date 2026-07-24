Feature: move-directory fallback is proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want src/utils/move-directory.ts under unit test
  So that the cross-platform archive move (rename fast-path plus the
    copy-then-remove fallback) is pinned to its contract on every platform

  Background:
    Given the tests build an isolated source tree under fs.mkdtemp(os.tmpdir())
    And each test removes its tmp tree in afterEach so no artifacts remain

  Scenario: moveDirectory uses the rename fast-path when rename succeeds
    Given a populated source directory and a destination that does not exist
    When moveDirectory runs
    Then the destination holds the moved contents and the source is gone

  Scenario: moveDirectory falls back to copy-then-remove on EPERM
    Given a rename seam that throws an error whose code is "EPERM"
    When moveDirectory runs over a nested source tree
    Then the destination is populated by a recursive copy
    And the source directory is removed afterwards

  Scenario: moveDirectory falls back to copy-then-remove on EXDEV
    Given a rename seam that throws an error whose code is "EXDEV"
    When moveDirectory runs
    Then it completes via the copy-then-remove fallback

  Scenario: moveDirectory rethrows any other rename error
    Given a rename seam that throws an error whose code is neither EPERM nor EXDEV
    When moveDirectory runs
    Then the original error is propagated to the caller

  Scenario: copyDirRecursive reproduces nested files and subdirectories
    Given a source tree with files nested inside subdirectories
    When copyDirRecursive runs
    Then every file and subdirectory is reproduced under the destination
