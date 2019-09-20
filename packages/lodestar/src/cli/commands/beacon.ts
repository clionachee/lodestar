/**
 * @module cli/commands
 */

import {ICliCommand} from "./interface";
import {CommanderStatic} from "commander";
import deepmerge from "deepmerge";

import {config as mainnetConfig} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {config as minimalConfig} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import {BeaconNode} from "../../node";
import {BeaconNodeOptions, IBeaconNodeOptions} from "../../node/options";
import {generateCommanderOptions, optionsToConfig} from "../util";
import {getTomlConfig} from "../../util/file";
import Validator from "../../validator";
import {RpcClientOverInstance} from "../../validator/rpc";
import {quickStartOptionToState} from "../../interop/cli";
import {ProgressiveMerkleTree} from "../../util/merkleTree";
import {InteropEth1Notifier} from "../../eth1/impl/interop";
import {ValidatorApi} from "../../api/rpc/api/validator";
import {BeaconApi} from "../../api/rpc/api/beacon";

interface IBeaconCommandOptions {
  configFile?: string;
  loggingLevel?: string;
  [key: string]: string;
}

export class BeaconNodeCommand implements ICliCommand {
  // @ts-ignore
  public node: BeaconNode;
  // @ts-ignore
  public validator: Validator;

  public register(commander: CommanderStatic): void {

    const logger = new WinstonLogger();
    //TODO: when we switch cli library make this to run as default command "./bin/lodestar"
    const command = commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-c, --configFile [config_file]", "Config file path")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + "\n" + e.stack);
        }
      });
    generateCommanderOptions(command, BeaconNodeOptions);
  }

  public async action(options: IBeaconCommandOptions, logger: ILogger): Promise<void> {
    let conf: Partial<IBeaconNodeOptions> = {};

    if (options.loggingLevel) {
      // eslint-disable-next-line no-undef
      // @ts-ignore
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    //merge config file
    if (options.configFile) {
      const parsedConfig = getTomlConfig(options.configFile, BeaconNodeOptions);
      //cli will override toml config options
      conf = deepmerge(conf, parsedConfig) as Partial<IBeaconNodeOptions>;
    }
    //override current config with cli config
    conf = deepmerge(conf, optionsToConfig(options, BeaconNodeOptions));

    const config = options.preset === "minimal" ? minimalConfig : mainnetConfig;

    this.node = new BeaconNode(conf, {config, logger});

    if(conf.validator && conf.validator.keypair){
      conf.validator.rpcInstance = new RpcClientOverInstance({
        config,
        validator: new ValidatorApi(
          {},
          {
            config,
            chain: this.node.chain,
            db: this.node.db,
            opPool: this.node.opPool,
            eth1: this.node.eth1,
            logger
          }
        ),
        beacon: new BeaconApi(
          {},
          {
            config,
            logger: new WinstonLogger(),
            sync: this.node.sync,
            eth1: this.node.eth1,
            opPool: this.node.opPool,
            chain: this.node.chain,
            db: this.node.db
          }
        ),
      });

      this.validator = new Validator(conf.validator, {config, logger});
      await this.validator.start();
    }

    await this.node.start();
  }
}
