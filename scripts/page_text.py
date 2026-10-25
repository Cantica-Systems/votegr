#!/usr/bin/env python3
# Released into the public domain under the Unlicense, see UNLICENSE.
"""A scraped page as its visible text, one line per element, defined once.

refresh_polling.py, refresh_gr_clerk.py and refresh_early_voting.py each
carried a copy of this, written as a regular expression that dropped
<script> and <style> blocks and turned every other tag into a line break. It
matched those blocks in lower case only, so a page that wrote <SCRIPT>, or
closed one with </script >, would have had its JavaScript read as text, a
line at a time, by parsers looking for precinct labels and street addresses.

The standard library's HTML parser knows where a script ends in every
spelling a browser accepts, so this uses that instead of a pattern. It is
standard library only, like the scripts that import it.
"""
from html.parser import HTMLParser

# Elements whose contents are never visible text.
HIDDEN = {"script", "style"}


class _VisibleText(HTMLParser):
    """Collects text outside HIDDEN elements. Every other tag, and every
    comment or declaration, becomes a line break, as the expression this
    replaces did; a hidden element becomes nothing, also as it did."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._hidden = None

    def handle_starttag(self, tag, attrs):
        if self._hidden:
            return
        if tag in HIDDEN:
            self._hidden = tag
        else:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if self._hidden:
            if tag == self._hidden:
                self._hidden = None
            return
        self.parts.append("\n")

    def handle_data(self, data):
        if not self._hidden:
            self.parts.append(data)

    def _break(self, _):
        if not self._hidden:
            self.parts.append("\n")

    handle_comment = handle_decl = handle_pi = unknown_decl = _break


def lines_of(page):
    """The page as visible text, one line per element, which is all the
    structure the refresh scripts need: every record they read is a label
    followed by its name and address on the next lines."""
    parser = _VisibleText()
    parser.feed(page)
    parser.close()
    text = "".join(parser.parts).replace("\xa0", " ")
    return [line.strip() for line in text.split("\n") if line.strip()]
