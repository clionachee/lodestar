import {phase0, Gwei} from "@chainsafe/lodestar-types";
import {bigIntSqrt, bigIntMax} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH as BASE_REWARDS_PER_EPOCH_CONST} from "../../../constants";

import {
  EpochContext,
  IEpochProcess,
  hasMarkers,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER,
  FLAG_PREV_TARGET_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER,
} from "../util";

/**
 * Return attestation reward/penalty deltas for each validator.
 */
export function getAttestationDeltas(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: phase0.BeaconState
): [number[], number[]] {
  const params = epochCtx.config.params;
  const validatorCount = process.statuses.length;
  const rewards = Array.from({length: validatorCount}, () => 0);
  const penalties = Array.from({length: validatorCount}, () => 0);

  const increment = params.EFFECTIVE_BALANCE_INCREMENT;
  let totalBalance = bigIntMax(process.totalActiveStake, increment);

  // increment is factored out from balance totals to avoid overflow
  const prevEpochSourceStake = bigIntMax(process.prevEpochUnslashedStake.sourceStake, increment) / increment;
  const prevEpochTargetStake = bigIntMax(process.prevEpochUnslashedStake.targetStake, increment) / increment;
  const prevEpochHeadStake = bigIntMax(process.prevEpochUnslashedStake.headStake, increment) / increment;

  // sqrt first, before factoring out the increment for later usage
  const balanceSqRoot = bigIntSqrt(totalBalance);
  const finalityDelay = BigInt(process.prevEpoch - state.finalizedCheckpoint.epoch);

  totalBalance = totalBalance / increment;

  const BASE_REWARD_FACTOR = BigInt(params.BASE_REWARD_FACTOR);
  const BASE_REWARDS_PER_EPOCH = BigInt(BASE_REWARDS_PER_EPOCH_CONST);
  const PROPOSER_REWARD_QUOTIENT = BigInt(params.PROPOSER_REWARD_QUOTIENT);
  const MIN_EPOCHS_TO_INACTIVITY_PENALTY = params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
  const INACTIVITY_PENALTY_QUOTIENT = params.INACTIVITY_PENALTY_QUOTIENT;
  const isInInactivityLeak = finalityDelay > MIN_EPOCHS_TO_INACTIVITY_PENALTY;

  process.statuses.forEach((status, i) => {
    const effBalance = status.validator.effectiveBalance;
    const baseReward = Number((effBalance * BASE_REWARD_FACTOR) / balanceSqRoot / BASE_REWARDS_PER_EPOCH);
    const proposerReward = Number(baseReward / Number(PROPOSER_REWARD_QUOTIENT));

    // inclusion speed bonus
    if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED)) {
      rewards[status.proposerIndex] += Number(proposerReward);
      const maxAttesterReward = baseReward - proposerReward;
      rewards[i] += Number(maxAttesterReward / status.inclusionDelay);
    }
    if (hasMarkers(status.flags, FLAG_ELIGIBLE_ATTESTER)) {
      const baseRewardsPerTotalBalance = BigInt(baseReward) / totalBalance;
      // expected FFG source
      if (hasMarkers(status.flags, FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED)) {
        // justification-participation reward
        rewards[i] += isInInactivityLeak ? baseReward : Number(baseRewardsPerTotalBalance * prevEpochSourceStake);
      } else {
        // justification-non-participation R-penalty
        penalties[i] += Number(baseReward);
      }

      // expected FFG target
      if (hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED)) {
        // boundary-attestation reward
        rewards[i] += isInInactivityLeak ? baseReward : Number(baseRewardsPerTotalBalance * prevEpochTargetStake);
      } else {
        // boundary-attestation-non-participation R-penalty
        penalties[i] += baseReward;
      }

      // expected head
      if (hasMarkers(status.flags, FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED)) {
        // canonical-participation reward
        rewards[i] += isInInactivityLeak ? baseReward : Number(baseRewardsPerTotalBalance * prevEpochHeadStake);
      } else {
        // non-canonical-participation R-penalty
        penalties[i] += baseReward;
      }

      // take away max rewards if we're not finalizing
      if (isInInactivityLeak) {
        penalties[i] += baseReward * Number(BASE_REWARDS_PER_EPOCH) - proposerReward;

        if (!hasMarkers(status.flags, FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED)) {
          penalties[i] += Number((effBalance * finalityDelay) / INACTIVITY_PENALTY_QUOTIENT);
        }
      }
    }
  });
  return [rewards, penalties];
}
