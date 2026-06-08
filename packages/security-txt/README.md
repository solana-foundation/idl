# @solana/security-txt

> **Status: scaffolded — public API locked, implementations to follow.** Not yet published to npm; the package is `private: true` until the bodies are filled in. See the stubs in `src/` for the exact shape.

Fetch a Solana program's [security.txt](https://github.com/neodyme-labs/solana-security-txt) from on-chain. Mirrors `@solana/idl`'s shape and resolution philosophy:

| Source           | How                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PMP (new)**    | A [Program Metadata](https://github.com/solana-program/program-metadata) account with seed `security.txt`, looked up canonical-first then via fallback authorities.            |
| **ELF (legacy)** | A `.security.txt` ELF section embedded in the program's BPF binary at build time, per [neodyme-labs/solana-security-txt](https://github.com/neodyme-labs/solana-security-txt). |

`fetchSecurityTxt` tries PMP first and falls back to ELF, returning `{ programId, type: 'pmp' | 'elf', content, fields }`.

## Public API (locked)

```ts
import { fetchSecurityTxt } from '@solana/security-txt';

const result = await fetchSecurityTxt(rpc, programId);
if (result) {
    console.log(result.type, result.fields.contacts);
}
```

| Export                      | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `fetchSecurityTxt`          | Headline. PMP-first → ELF fallback                  |
| `fetchPmpSecurityTxt`       | Live PMP security.txt only                          |
| `fetchElfSecurityTxt`       | Live ELF-embedded security.txt only                 |
| `findPmpSecurityTxtAddress` | PDA derivation helper (pins seed to `security.txt`) |
| `SECURITY_TXT_PMP_SEED`     | The seed constant (`'security.txt'`)                |

Types: `SecurityTxt`, `SecurityTxtSource`, `SecurityTxtFields`, `PmpSecurityTxt`, `ElfSecurityTxt`.

## License

MIT — see [LICENSE](./LICENSE).
