//go:build darwin && arm64

package bundled

import _ "embed"

//go:embed assets/darwin_arm64/mutagen
var mutagenBinary []byte

//go:embed assets/darwin_arm64/mutagen-agents.tar.gz
var agentsArchive []byte
