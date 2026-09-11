# LocalLeaf for VS Code

Install the LocalLeaf Python backend, open a `.tex` file, and run
**LocalLeaf: Open LaTeX Editor**. The extension uses a workspace `.venv` when
available, or system Python. Set `localleaf.pythonPath` to an installed backend's
Python interpreter to use LocalLeaf across your CV and manuscript repositories.

The handover CV editor is restored: rich visual editing, Code switching, optional
PDF preview, formatting menus, and PDF/DOCX export. Each panel starts a private
loopback backend and stops it when closed. Save before closing the panel.

LaTeX compilation requires an installed engine. CV DOCX uses the direct exporter;
general DOCX export requires Pandoc. Local desktop workspaces are the initial target.
