import {Version, Root, ForkData, ForkDigest} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";


export function computeForkDataRoot(config: IBeaconConfig, currentVersion: Version, genesisValidatorsRoot: Root): Root {
  const forkData: ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return config.types.ForkData.hashTreeRoot(forkData);
}

export function computeForkDigest(
  config: IBeaconConfig,
  currentVersion: Version,
  genesisValidatorsRoot: Root): ForkDigest {
  const root = computeForkDataRoot(config, currentVersion, genesisValidatorsRoot);
  return [root[0], root[1], root[2], root[3]];
}