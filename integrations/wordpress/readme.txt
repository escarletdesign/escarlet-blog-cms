=== Escarlet Elementor Bridge ===
Contributors: escarlet
Requires at least: 6.8
Requires PHP: 8.1
Stable tag: 0.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Secure REST and MCP bridge for editable Elementor documents.

== Description ==

Escarlet Elementor Bridge lets an authorized local MCP server inspect and modify WordPress pages built with Elementor using real containers and widgets. It does not generate a single HTML widget and does not expose Elementor's private data field directly.

Elementor is optional for activation and diagnostics. Elementor Pro is not bundled and is required for Theme Builder footer creation.

== Security ==

Use HTTPS and a dedicated WordPress user with an Application Password. Enable external writes only after reviewing the permissions and staging environment. See SECURITY.md in the source distribution.

== Changelog ==

= 0.2.0 =
* Discover the active Elementor/Pro widget registry and native controls through the installed Widgets Manager.
* Expose versioned widget capabilities with verified, native-pass-through and blocked states.
* Permit registered safe widgets to be inserted with native Elementor settings while keeping unsafe HTML/code widgets blocked.
* Add capability refresh support with `GET /capabilities?refresh=1`.

= 0.1.10 =
* Add versioned read-modify-write operations for existing Theme Builder footers.
* Add support for Elementor's native Accordion widget.

= 0.1.9 =
* Fix the Elementor Pro Conditions Manager payload so existing Theme Builder conditions can be synchronized successfully.

= 0.1.8 =
* Save Theme Builder display conditions through Elementor Pro's Conditions Manager so global footers render on the frontend.
* Add a checkpointed REST/MCP operation to synchronize conditions on existing footer templates.

= 0.1.7 =
* Add an adapter-backed REST/MCP flow to list and create global footer templates in Elementor Pro.
* Require explicit confirmation and preserve footer conditions/checkpoints without exposing Elementor data directly.

= 0.1.6 =
* Synchronize the PHP validator with the supported navigation menu and image carousel widgets.

= 0.1.5 =
* Preserve Elementor page document type, typed widget settings, backgrounds and overlays.

= 0.1.4 =
* Write Elementor document elements with the official `id`/`isInner` structure so the visual editor can load them.

= 0.1.3 =
* Stabilize discovery identities for existing Elementor nodes that do not have Escarlet markers yet.

= 0.1.2 =
* Keep volatile Elementor internal IDs out of the neutral document version hash.

= 0.1.1 =
* Preserve external node IDs in Elementor settings so partial updates remain safe across reads.

= 0.1.0 =
* Initial MVP.
