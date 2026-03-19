RMU Managed Effects streamlines the application of spell-based modifiers in Rolemaster Unified (RMU) for Foundry VTT.

This module automatically discovers known spells from an actor’s spell lists and maps them to preconfigured Active Effects, allowing players and GMs to apply bonuses, penalties, and status effects with a single click. It integrates directly with RMU’s spell system, respects duration mechanics (including rounds vs. time), and updates existing effects instead of duplicating them.

Designed for speed and accuracy at the table, it eliminates manual entry of spell effects while remaining flexible and system-consistent.

Features

Automatically detects known RMU spells and presents them as selectable effects

Applies Active Effects with correct targeting (self, single, multiple, or area)

Supports RMU-style durations (rounds in combat, time out of combat)

Prevents duplicate effects by intelligently updating existing ones

Allows players to apply effects when they have permission; falls back to GM when needed

Configurable, definition-driven system for adding new spells and effects

Clean dialog interface integrated into token controls

Compatibility

Requires the Rolemaster Unified (RMU) system

Built for Foundry VTT v13

Notes

This module does not include RMU rules content. It operates on existing spell data within the RMU system.

To Use

Add a script macro with the following command: await game.modules.get("rmu-managed-effects")?.api?.openApplyEffectDialog();