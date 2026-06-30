# -*- coding: utf-8 -*-
import sys
from docx import Document
from docx.oxml.ns import qn
P = r"\\2s-eng-servidor\maringa\PLANILHAS FINAIS\UBIRATÃ\PO-01\SBB-01\MD-048-GER-PB-PBEN-02-R0.docx"
doc = Document(P)
out = []
body = doc.element.body
# walk body in order, interleaving paragraphs and tables
from docx.text.paragraph import Paragraph
from docx.table import Table
pi = 0; ti = 0
for child in body.iterchildren():
    tag = child.tag.split('}')[-1]
    if tag == 'p':
        p = Paragraph(child, doc)
        t = (p.text or "").strip()
        st = p.style.name if p.style else "?"
        if t:
            out.append("P%03d [%s] %s" % (pi, st, t))
        pi += 1
    elif tag == 'tbl':
        tb = Table(child, doc)
        out.append("== TABELA T%d (%dx%d) ==" % (ti, len(tb.rows), len(tb.columns)))
        for r in tb.rows:
            cells = [c.text.strip().replace("\n"," ") for c in r.cells]
            out.append("   | " + " | ".join(cells))
        ti += 1
with open(r"C:\Users\lcabd\AppData\Local\Temp\claude\C--Users-lcabd\ea7ea8c4-9e05-4292-9d4b-335930a19f2c\scratchpad\md048_full.txt","w",encoding="utf-8") as f:
    f.write("\n".join(out))
print("paragrafos:", pi, "tabelas:", ti, "linhas dump:", len(out))
