# Third-party notices

TapeSign is licensed under MIT; dependency licenses remain applicable to those dependencies. The lockfile records exact dependency versions.

| Component | Purpose | License / provenance |
| --- | --- | --- |
| ethers | Ethereum encoding, hashes and wallet signature verification | MIT; Richard Moore |
| Vite | Development server and static build | MIT; Vite contributors |
| Playwright | Browser tests and development HTTP transport | Apache-2.0; Microsoft |
| esbuild | Cache-service bundle | MIT; Evan Wallace |
| src/vendor/ helpers | TapeOut endpoint, identity and independent-RPC utilities | Adapted from the same author's DeSQL project; published here with TapeSign |
| TapeKit / TapeOut | Protocol, ABI, container and gateway reference | MIT; TapeOutProtocol |
| OpenZeppelin Contracts 5.2.0 | Solidity signature checks, reentrancy guard and ERC20 transfer helpers | MIT; OpenZeppelin |
| solc 0.8.30 | Reproducible wallet compilation (development dependency) | MIT; Solidity contributors |
| Ganache 7.9.2 | Isolated local EVM tests and demo (development dependency) | MIT; Iuri Matias and ConsenSys Software Inc |

Dependency distributions contain their full notices, including transitive dependencies. Consult node_modules/<package>/LICENSE or LICENSE.md after npm ci. No wallet key, ledger database, private DeSQL deployment or real contract evidence is included.

## OpenZeppelin Contracts license

The MIT License (MIT)

Copyright (c) 2016-2024 Zeppelin Group Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## TapeKit reference license text

MIT License

Copyright (c) 2026 TapeOutProtocol

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
