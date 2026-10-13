# Liability and the document store

Not legal advice. Nobody on this team is a lawyer and neither am I. This is
a list of the questions to take to someone who is, so the meeting is short
and productive.

GW has a Small Business and Community Economic Development Clinic at the law
school that advises early-stage ventures at no cost, and students are exactly
who it exists for. That is the first call.

## 1. Are we preparing tax returns

The line that matters. Paid return preparation requires a PTIN and pulls in
Circular 230 and preparer penalty exposure. Educational information does not.

Three things move you toward the wrong side of that line:

- Charging money (the university license does exactly this)
- Producing something that functions as a completed return
- Storing a student's documents and figures and handing back numbers to file

The current build stays clearly educational: it names screens, the student
enters everything into their own software, and nothing is transmitted.

Once documents are stored server-side and a worksheet returns computed
figures, it looks less like a textbook and more like a service. Ask counsel
where they think you sit, and ask before you build the database, not after.

## 2. Being wrong about tax

Preparers carry professional exposure through Circular 230 and penalty
provisions. Educational publishers generally do not, because the reader
chose to rely on the information.

Standard protections, all of which need a lawyer to draft properly:

- Terms of use with a disclaimer of warranties and a limitation of liability
- An explicit statement that the tool does not prepare or file returns
- Assumption disclosure, which the plan and worksheet already do
- Errors and omissions insurance before any money changes hands

The version you have helps here. The plan states what it excludes, the
worksheet carries a caution, and the nonresident path refuses rather than
guessing. That pattern is worth keeping: a tool that declines when unsure is
easier to defend than one that always answers.

## 3. The big one: holding student tax documents

This is a larger exposure than being wrong about a bracket, and it arrives
the moment the database does.

**The FTC Safeguards Rule.** Under the Gramm-Leach-Bliley Act, businesses
that prepare tax returns are treated as financial institutions and must keep
a written information security plan, name someone responsible for it, run
risk assessments, encrypt customer information, and report certain breaches.
IRS Publication 4557 covers what this means in practice. Whether it reaches
you depends on question 1 above, which is another reason to settle that first.

**State breach notification.** All fifty states require notification after a
breach of personal information. A W-2 carries a name, an address, an employer,
wages and often a Social Security number. That is about the most notifiable
combination that exists.

**FERPA.** If GW routes students to you or the tool touches student records,
the university's obligations may extend to you through the contract. GW's
Office of the General Counsel will have a view, and they will be asked
regardless during procurement.

## 4. What to do about it in the build

Ordered by how much exposure each one removes per hour spent.

1. **Do not store Social Security numbers. Ever.** There is no field for one
   now. Keep it that way, and say so in the contract. It is the single
   largest reduction in breach severity available to you.
2. **Do not store the documents themselves if you can avoid it.** Extract the
   figures, discard the file. A database of amounts is far less attractive
   and far less notifiable than a folder of W-2 PDFs.
3. **If documents must persist, encrypt at rest, scope access per user, and
   set an automatic deletion window.** Say eighteen months, which covers one
   amendment cycle.
4. **Form an entity before launch.** An LLC separates the team personally
   from the business. Operating as five students under their own names is the
   avoidable mistake.
5. **Demo on synthetic data.** Nothing changes a procurement conversation
   faster than being able to say no real student data has ever been in it.
6. **Keep the review step.** It is a genuine control, not just UX. The user
   confirms every extracted figure against the paper, which means a misread
   is the user's correction to make rather than the software's silent error.

## Document store schema for phase two

```
documents
  id
  user_id
  tax_year
  form_type            W-2, 1098-T, 1099-NEC, ...
  storage_key          object storage reference, encrypted at rest
  original_filename
  uploaded_at
  delete_after         set on insert; a job enforces it
  extraction_status    pending | extracted | manual | failed

extracted_values
  id
  document_id
  field_key            w2wage, tuition, scholarship, ...
  raw_value            what the reader saw
  confirmed_value      what the user accepted
  confirmed_at         null until the user reviews it
```

Splitting raw from confirmed is what lets you answer the question that will
eventually be asked, which is whether a wrong figure came from your reader
or from the student. It also gives you an accuracy measurement, and reader
accuracy per form type is a real finding for the analysis component.

## Two questions to bring to the clinic

1. Does charging a university for an educational tool that reads tax
   documents and produces a filing worksheet make us tax return preparers
   under Circular 230, and does the FTC Safeguards Rule apply to us?
2. If GW licenses this for its students, who carries the risk of a breach,
   and what indemnification and insurance will the university require?
