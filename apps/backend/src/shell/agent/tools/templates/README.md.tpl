# Omnidraw widget project

Run `npm run check` for deterministic offline repository validation. It checks
the manifest, source, TypeScript, and statically visible function/resource
contracts. It does not contact Omnidraw and does not prove that a resource id exists,
that Preview renders, or that runtime/provider behavior works.

Run `npm run build` separately to create `dist/` and the portable build receipt.
The Omnidraw host must independently accept that receipt before the changed
generation is eligible for Preview or publication. Use the host-aware Preview
inspection workflow to verify the actual accepted Preview generation.
