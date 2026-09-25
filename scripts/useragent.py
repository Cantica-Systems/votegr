#!/usr/bin/env python3
# Released into the public domain under the Unlicense, see UNLICENSE.
"""The User-Agent every script here sends, defined once.

An honest name, with a link back to this repository, so a server's log can
tell who was asking. One definition means every script says the same thing,
and moving the repository is one edit rather than sixteen. The two tools
written for node, check_links.mjs and compare_osrm.mjs, cannot import this
and carry the same URL themselves; change them with it.
"""
USER_AGENT = "vote-gr/1.0 (+https://github.com/Cantica-Systems/votegr)"
