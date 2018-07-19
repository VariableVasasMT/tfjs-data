/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * =============================================================================
 */

// tslint:disable:max-line-length
import {OrderedLazyIterator, StatefulLazyIterator, StatefulOneToManyIterator, StatefulPumpResult} from './stateful_iterator';

// tslint:enable:max-line-length

export interface StringCarryover {
  // A partial string at the end of an upstream chunk
  readonly carryover: string;
}

export abstract class StringChunkIterator extends
    StatefulLazyIterator<string, StringCarryover> {
  /**
   * Splits a string stream on a given separator.
   *
   * It is assumed that the incoming chunk boundaries have no semantic meaning,
   * so conceptually the incoming stream is treated simply as the concatenation
   * of its elements.
   *
   * The outgoing stream provides chunks corresponding to the results of the
   * standard string split() operation (even if such a chunk spanned incoming
   * chunks).  The separators are not included.
   *
   * A typical usage is to split a text file (represented as a stream with
   * arbitrary chunk boundaries) into lines.
   *
   * @param upstream A readable stream of strings that can be treated as
   *   concatenated.
   * @param separator A character to split on.
   */
  split(separator: string): OrderedLazyIterator<string> {
    return new SplitIterator(this, separator);
  }
}

// ============================================================================
// The following private classes serve to implement the chainable methods
// on StringIterator.  Unfortunately they can't be placed in separate files, due
// to resulting trouble with circular imports.
// ============================================================================

// We wanted multiple inheritance, e.g.
//   class SplitIterator extends QueueIterator<string>, StringIterator
// but the TypeScript mixin approach is a bit hacky, so we take this adapter
// approach instead.

class SplitIterator extends StringChunkIterator {
  private impl: SplitIteratorImpl;

  constructor(
      upstream: StatefulLazyIterator<string, StringCarryover>,
      separator: string) {
    super();
    this.impl = new SplitIteratorImpl(upstream, separator);
  }

  initialState() {
    return this.impl.initialState();
  }

  async statefulNext(state: StringCarryover) {
    return this.impl.statefulNext(state);
  }
}

class SplitIteratorImpl extends
    StatefulOneToManyIterator<string, StringCarryover> {
  constructor(
      protected upstream: StatefulLazyIterator<string, {}>,
      protected separator: string) {
    super();
  }

  initialState() {
    return {carryover: ''};
  }

  async statefulPump(state: StringCarryover):
      Promise<StatefulPumpResult<StringCarryover>> {
    const chunkResult = await this.upstream.next();
    if (chunkResult.done) {
      if (state.carryover === '') {
        return {pumpDidWork: false, state};
      }

      // Pretend that the pump succeeded in order to emit the small last batch.
      // The next pump() call will actually fail.
      console.log('Pushing carryover, WAT: ' + state.carryover);
      this.outputQueue.push(state.carryover);
      return {pumpDidWork: true, state: {carryover: ''}};
    }
    console.log('Splitting: ' + chunkResult.value);
    const lines = chunkResult.value.split(this.separator);
    // Note the behavior: " ab ".split(' ') === ['', 'ab', '']
    // Thus the carryover may be '' if the separator falls on a chunk
    // boundary; this produces the correct result.

    lines[0] = state.carryover + lines[0];
    for (const line of lines.slice(0, -1)) {
      console.log('Pushing: ' + line);
      this.outputQueue.push(line);
    }
    const newCarryover = lines[lines.length - 1];

    console.log('Carryover: ' + newCarryover);

    return {pumpDidWork: true, state: {carryover: newCarryover}};
  }
}