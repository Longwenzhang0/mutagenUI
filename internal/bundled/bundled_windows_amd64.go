//go:build windows && amd64

package bundled

import _ "embed"

//go:embed assets/windows_amd64/mutagen.exe
var mutagenBinary []byte

//go:embed assets/windows_amd64/mutagen-agents.tar.gz
var agentsArchive []byte
