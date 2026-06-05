# Dev-only local install wrapper for the `ratchet` CLI.
# The publish-bound core lives in package.json scripts; this Makefile just
# provides the literal install/uninstall verbs plus the machine-specific
# asdf reshim (a global bin only becomes usable after `asdf reshim nodejs`).
#
# Note: uses `npm run link` / `npm run unlink` (the package scripts), NOT the
# pnpm `link`/`unlink` builtins. The package `link` script uses `npm link`
# because pnpm's global bin dir isn't on PATH here and `pnpm setup` is intrusive.

.PHONY: help install uninstall reinstall

# Re-shim only when asdf is present, so this stays portable to non-asdf machines.
RESHIM = command -v asdf >/dev/null 2>&1 && asdf reshim nodejs || true

help:
	@echo "ratchet dev install wrapper:"
	@echo "  make install     build + globally link ratchet, then asdf reshim"
	@echo "  make uninstall   remove the global ratchet link, then asdf reshim"
	@echo "  make reinstall   uninstall then install"

install:
	pnpm run link
	@$(RESHIM)
	@echo "ratchet installed from $$(git rev-parse --abbrev-ref HEAD) @ $$(git rev-parse --short HEAD)"

uninstall:
	pnpm run unlink
	@$(RESHIM)
	@echo "ratchet uninstalled"

reinstall: uninstall install
