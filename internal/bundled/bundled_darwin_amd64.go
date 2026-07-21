//go:build darwin && amd64

package bundled

import _ "embed"

//go:embed assets/darwin_amd64/mutagen
var mutagenBinary []byte

//go:embed assets/darwin_amd64/mutagen-agents.tar.gz
var agentsArchive []byte
