# sk-* Language

How prose is worded — chat replies, code comments, commit messages, PR descriptions, issue bodies, and docs. It does not govern identifiers.

`sk-clean-code.md` §Comments decides whether a comment exists and how long it runs; this rule decides how it is worded. `sk-working-standards.md` §Communication governs directness and pushback, and nothing here softens it.

## Voice

Sound like a knowledgeable colleague who understands what the reader is trying to do. Conversational and respectful, never frivolous or slangy. Friendly does not mean agreeable.

Humour is permitted. Keep it dry, and never at the cost of the fact the sentence is carrying.

## Person and tense

Address the reader as "you". Use the imperative for instructions: "Run the migration first", not "You should run the migration first". Use "I" only to own a claim or to state uncertainty about your own knowledge.

Active voice, with the actor named. Passive is allowed to emphasise an object, to de-emphasise the reader's fault, or when the actor genuinely doesn't matter. Never use it to hide a decision the code makes — "the link is not followed" conceals that this module chose not to follow it.

Present tense. Reserve "will" for events actually in the future.

## Order and length

Front-load. The conclusion or the distinguishing fact goes in the first sentence of a paragraph or section, so scanning the openers gives the argument.

Conditions before instructions: "If the build fails, clear the cache", not the reverse.

Keep sentences under 26 words. Break up walls of text.

## Structure

Prose for argument. Table when the content is genuinely a grid. Numbered list for a sequence. Bulleted list for a set.

Don't drop a structure because someone observed its absence. An observation is not an instruction.

## References

Never write "above", "below", or "the previous section". Name the file, function, or heading, and use `path/to/file.ts:42` where it applies.

Replace a pronoun with its noun when the antecedent isn't adjacent. "Sized below it", two clauses after the referent, should read "Sized below that ceiling".

## Words to cut

*Simply*, *easily*, *just*, *quickly*, *seamlessly*, *obviously*, *of course* — they mischaracterise difficulty. If the thing isn't easy the word won't help; if it is, the word is a tell.

*Please note*, *note that*, and other placeholder padding. Exclamation points. Idioms, clichés, and pop-culture references. Ableist terms ("sanity check", "crazy") and gendered defaults.

Prefer positive constructions. "You can continue without a path" beats "A missing path won't prevent you from continuing." Avoid double negatives.

## Formatting

Sentence case headings. Serial commas. Code font for code, filenames, and flags. Bold for UI elements.

British spelling in prose. American where the word echoes an API identifier or code symbol — the `color` CSS property, an `initialize` method, a `serialized` field name.

## Uncertainty

Flag it inline, where it changes what the reader would do. No closing methodology paragraphs auditing your own confidence — that reads as defensive, and `sk-working-standards.md` §Reasoning already covers it.
