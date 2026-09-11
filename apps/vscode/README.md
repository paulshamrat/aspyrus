# LocalLeaf for VS Code (alpha)

Install the LocalLeaf Python backend first. Set `localleaf.pythonPath` to that
Python interpreter, then open a `.tex` file and run **LocalLeaf: Open LaTeX Editor**.

Each panel starts a private loopback backend and stops it when closed. Save your
work before closing the panel. PDF compilation requires a LaTeX engine; DOCX
export requires Pandoc. Local desktop workspaces are the tested target; remote
SSH, containers, and web-only VS Code are not yet supported release targets.

Visual editing supports ordinary text, basic headings, bold, italic, and underline.
Other LaTeX stays in protected source blocks. PDF preview is a canvas preview;
use an external PDF viewer for search, selection, and accessibility features.
