"""Read selected shapes on a local, passive Word copy; all arguments are host-owned."""
import json
import os
from pathlib import Path
import subprocess
import zipfile
from xml.dom import minidom
import sys
import time
import uuid

import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
from com.sun.star.document.UpdateDocMode import NO_UPDATE
import threading

def prop(name, value):
    item = PropertyValue()
    item.Name, item.Value = name, value
    return item

def run(folder):
    pipe = "contractor" + uuid.uuid4().hex
    targets = json.loads((folder / "targets.json").read_text(encoding="utf-8"))
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    options = ["-env:UserInstallation=" + (folder / "profile").as_uri(), "--headless", "--norestore", "--nodefault", "--nofirststartwizard", "--accept=pipe,name=" + pipe + ";urp;StarOffice.ServiceManager"]
    process = subprocess.Popen([str(Path(sys.executable).parent / "soffice.exe"), *options], cwd=folder, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    def deadline():
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        os._exit(124)
    watchdog = threading.Timer(180, deadline)
    watchdog.daemon = True
    watchdog.start()
    desktop = document = None
    opened = []
    try:
        for attempt in range(100):
            try:
                context = resolver.resolve("uno:pipe,name=" + pipe + ";urp;StarOffice.ComponentContext")
                break
            except Exception:
                if attempt == 99: raise
                time.sleep(0.2)
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        settings = (prop("Hidden", True), prop("ReadOnly", True), prop("Silent", True), prop("MacroExecutionMode", NEVER_EXECUTE), prop("UpdateDocMode", NO_UPDATE))
        document = desktop.loadComponentFromURL((folder / "source.docx").as_uri(), "_blank", 0, settings)
        if document is None: raise ValueError("Cannot open document")
        opened.append(document)
        def candidates(doc):
            items = list(doc.DrawPage)
            frames = doc.getTextFrames()
            for name in frames.getElementNames():
                frame = frames.getByName(name)
                if not any(frame == item for item in items): items.append(frame)
            return items

        cursor = document.getCurrentController().getViewCursor()
        shapes = []
        for shape in candidates(document):
            if shape.Name not in targets: continue
            item = {"name": shape.Name, "page": None, "placementVerified": False}
            try:
                cursor.gotoRange(shape.Anchor, False)
                item["page"] = int(cursor.getPage())
            except Exception: pass
            try:
                item["widthMm100"], item["heightMm100"] = int(shape.Size.Width), int(shape.Size.Height)
            except Exception: pass
            shapes.append(item)
        grouped = []
        for item in shapes:
            same = [other for other in shapes if other["name"] == item["name"]]
            if any(other["name"] == item["name"] for other in grouped): continue
            item["instances"] = len(same)
            item["consistentSize"] = all((other.get("widthMm100"), other.get("heightMm100")) == (item.get("widthMm100"), item.get("heightMm100")) for other in same)
            grouped.append(item)
        shapes = grouped
        document.storeToURL((folder / "source.pdf").as_uri(), (prop("FilterName","writer_pdf_Export"),))
        primary = document
        # Keep the original open so closing a probe does not terminate Writer.
        document = None
        # Compare independently opened passive copies. Removing a shape can reflow
        # text, which is why the host validates a small bounded pixel difference.
        for index, item in enumerate(shapes[:16]):
            if not item["consistentSize"]: continue
            probe_path = folder / ("probe-%04d.docx" % index)
            # Remove exactly one named VML object from a second package. This
            # avoids modifying live UNO shape objects (some importers crash).
            with zipfile.ZipFile(folder / "source.docx") as source:
                replacement = None
                for part in source.namelist():
                    if not part.startswith("word/") or not part.endswith(".xml"): continue
                    dom = minidom.parseString(source.read(part))
                    matches = [node for node in dom.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "*") if node.getAttribute("id") == item["name"]]
                    if len(matches) > 1 or (matches and replacement is not None):
                        replacement = None
                        break
                    if matches:
                        node = matches[0]
                        alternate = node.parentNode
                        while alternate is not None and alternate.localName != "AlternateContent": alternate = alternate.parentNode
                        if alternate is not None:
                            # Writer displays the primary DrawingML branch. A VML
                            # fallback names that same object only when the single
                            # outer drawing declares exactly the same source name.
                            primary = [element for element in alternate.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "docPr")]
                            pict = node.parentNode
                            while pict is not None and pict.localName != "pict": pict = pict.parentNode
                            top = [] if pict is None else [child for child in pict.childNodes if child.nodeType == child.ELEMENT_NODE and child.namespaceURI == "urn:schemas-microsoft-com:vml" and child.localName != "shapetype"]
                            if len(primary) != 1 or primary[0].getAttribute("name") != item["name"] or len(top) != 1 or top[0] != node: continue
                            node = alternate
                        node.parentNode.removeChild(node)
                        replacement = (part, dom.toxml(encoding="utf-8"))
                if replacement is None: continue
                with zipfile.ZipFile(probe_path, "w", zipfile.ZIP_DEFLATED) as target:
                    for part in source.namelist(): target.writestr(part, replacement[1] if part == replacement[0] else source.read(part))
            try:
                document = desktop.loadComponentFromURL(probe_path.as_uri(), "_blank", 0, settings)
            except Exception:
                item["comparisonError"] = "WORD_LAYOUT_COMPARISON_FAILED"
                break
            if document is None: raise ValueError("Cannot reopen passive document")
            opened.append(document)
            matches = [shape for shape in candidates(document) if shape.Name == item["name"]]
            if not matches:
                try:
                    filename = "without-%04d.pdf" % index
                    document.storeToURL((folder / filename).as_uri(), (prop("FilterName","writer_pdf_Export"),))
                    item["differenceFile"] = filename
                except Exception: pass
            # Closing an individual hidden Writer probe can dispose the process
            # while another imported document is still being paginated. Retain
            # at most 16 bounded probes until all exports have completed.
            document = None
        document = primary
        (folder / "shapes.json").write_text(json.dumps(shapes), encoding="utf-8")
    finally:
        # Some Writer builds dispose the bridge while closing the last document.
        # Cleanup must not hide a successful PDF export or its original failure.
        for opened_document in reversed(opened):
            try: opened_document.close(True)
            except Exception: pass
        try:
            if desktop is not None: desktop.terminate()
        except Exception: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill()
        watchdog.cancel()

if __name__ == "__main__":
    run(Path.cwd())
