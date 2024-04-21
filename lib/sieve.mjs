import { log } from "./log.mjs";

const evalLog = (...args) => {
  if (process.env.DEBUG_SIEVE) {
    log(...args);
  }
};

function isWordCharacter(c) {
  return /^[a-zA-Z]$/.test(c);
}

function isWhitespace(c) {
  return /^\s$/.test(c);
}

const specialChars = ["[", "]", ",", ";", "(", ")", "{", "}", ":"];

/**
 * @param {string} src
 */
function tokenize(src) {
  let i = 0;
  const tokens = [];

  function assert(test) {
    if (!test) {
      throw new Error(`Unexpected char "${src[i]}" at pos ${i}`);
    }
  }

  function isEOF() {
    return i >= src.length;
  }

  function readWhile(test) {
    let s = "";
    while (test(src[i])) {
      s += src[i];
      i++;
    }
    return s;
  }

  const readWord = () => readWhile(isWordCharacter);

  function readString() {
    assert(src[i] == '"');
    let s = "";
    i++;
    while (!isEOF() && src[i] !== '"') {
      if (src[i] === "\\") {
        i++;
        if (src[i] === "\\" || src[i] === '"') {
          s += src[i];
          i++;
        }
      } else {
        s += src[i];
        i++;
      }
    }
    assert(src[i] == '"');
    i++;
    return s;
  }

  while (!isEOF()) {
    if (isWhitespace(src[i])) {
      while (isWhitespace(src[i])) {
        i++;
      }
      continue;
    }

    let pos = i;

    if (isWordCharacter(src[i])) {
      tokens.push({
        type: "identifier",
        value: readWord(),
        pos,
      });
    } else if (src[i] == '"') {
      tokens.push({
        type: "string",
        value: readString(),
        pos,
      });
    } else if (specialChars.includes(src[i])) {
      tokens.push({
        type: src[i],
        value: src[i],
        pos,
      });
      i++;
    } else {
      assert(false);
    }
  }

  tokens.push({
    type: "EOF",
    value: "",
    pos: i,
  });

  return tokens;
}

export function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  let token = tokens[0];
  let nextToken = tokens[1];

  function next() {
    i++;
    token = tokens[i];
    nextToken = tokens[i + 1];
  }

  /**
   * @param {string[]} types
   */
  function assertType(types) {
    if (!types.includes(token.type)) {
      throw new Error(
        `Unexpected ${token.type} at pos ${token.pos}, expected (${types.join(
          "|"
        )})`
      );
    }
  }

  /**
   * @param {string[]} words
   */
  function assertIdentifier(words) {
    assertType(["identifier"]);
    if (!words.includes(token.value)) {
      throw new Error(
        `Unexpected ${token.value} at pos ${token.pos}, expected (${words.join(
          "|"
        )})`
      );
    }
  }

  function parseString() {
    assertType(["string"]);
    const value = token.value;
    next();
    return { type: "string", value };
  }

  function parseStringList() {
    if (token.type === "string") {
      const value = parseString();
      return { type: "string_list", values: [value] };
    }

    assertType(["["]);
    next();
    const values = [];
    while (true) {
      values.push(parseString());

      if (token.type === "]") {
        next();
        return { type: "string_list", values };
      }

      assertType([","]);
      next();
    }
  }

  function parseRequire() {
    assertIdentifier(["require"]);
    next();
    const capabilities = parseStringList();
    assertType([";"]);
    next();
    return {
      type: "require",
      capabilities,
    };
  }

  function tryParseComparator() {
    if (
      token.type === ":" &&
      nextToken.type === "identifier" &&
      nextToken.value === "comparator"
    ) {
      next();
      next();
      const comparator = parseString();
      return { type: "comparator", comparator };
    }
  }

  function tryParseMatchType() {
    if (
      token.type === ":" &&
      nextToken.type === "identifier" &&
      ["is", "contains", "matches"].includes(nextToken.value)
    ) {
      const matchType = nextToken.value;
      next();
      next();
      return { type: "match_type", matchType };
    }
  }

  function tryParseAddressPart() {
    if (
      token.type === ":" &&
      nextToken.type === "identifier" &&
      ["localpart", "domain", "all"].includes(nextToken.value)
    ) {
      const addressPart = nextToken.value;
      next();
      next();
      return { type: "address_part", addressPart };
    }
  }

  function parseHeaderTest() {
    assertIdentifier(["header"]);
    next();

    const comparator = tryParseComparator();
    const matchType = tryParseMatchType();
    const headerNames = parseStringList();
    const keyList = parseStringList();

    return { type: "header_test", comparator, matchType, headerNames, keyList };
  }

  function parseAddressTest() {
    assertIdentifier(["address"]);
    next();

    const comparator = tryParseComparator();
    const addressPart = tryParseAddressPart();
    const matchType = tryParseMatchType();
    const headerList = parseStringList();
    const keyList = parseStringList();

    return {
      type: "address_test",
      comparator,
      addressPart,
      matchType,
      headerList,
      keyList,
    };
  }

  function parseTestList() {
    assertType(["("]);
    next();
    const tests = [];
    while (true) {
      tests.push(parseTest());

      if (token.type == ")") {
        next();
        return tests;
      }

      assertType([","]);
      next();
    }
  }

  function parseAllOf() {
    assertIdentifier(["allof"]);
    next();
    const tests = parseTestList();
    return {
      type: "allof",
      tests,
    };
  }

  function parseAnyOf() {
    assertIdentifier(["anyof"]);
    next();
    const tests = parseTestList();
    return {
      type: "anyof",
      tests,
    };
  }

  function parseTest() {
    assertIdentifier(["header", "address", "allof", "anyof"]);
    if (token.value === "header") {
      return parseHeaderTest();
    } else if (token.value === "address") {
      return parseAddressTest();
    } else if (token.value === "allof") {
      return parseAllOf();
    } else if (token.value === "anyof") {
      return parseAnyOf();
    }
  }

  function parseKeep() {
    assertIdentifier(["keep"]);
    next();
    assertType([";"]);
    next();
    return { type: "keep" };
  }

  function parseDiscard() {
    assertIdentifier(["discard"]);
    next();
    assertType([";"]);
    next();
    return { type: "discard" };
  }

  function parseBlock() {
    assertType(["{"]);
    next();
    const commands = parseCommands();
    assertType(["}"]);
    next();
    return {
      type: "block",
      commands,
    };
  }

  function parseIf(allowed = "if") {
    assertIdentifier([allowed]);
    next();
    const test = parseTest();
    const block = parseBlock();
    let elseStatement;
    if (token.type === "identifier" && token.value === "elsif") {
      elseStatement = parseIf("elsif");
    } else if (token.type === "identifier" && token.value === "else") {
      next();
      elseStatement = parseBlock();
    }
    return {
      type: "if",
      test,
      block,
      elseStatement,
    };
  }

  function parseAddFlag() {
    assertIdentifier(["addflag"]);
    next();
    let variablename;
    if (token.type === "string" && nextToken.type === "string") {
      variablename = token.value;
      next();
    }
    const listOfFlags = parseStringList();
    assertType([";"]);
    next();
    return {
      type: "addflag",
      variablename,
      listOfFlags,
    };
  }

  function parseFileInto() {
    assertIdentifier(["fileinto"]);
    next();
    const mailbox = parseString();
    assertType([";"]);
    next();
    return { type: "fileinto", mailbox };
  }

  function parseCommand() {
    assertIdentifier([
      "require",
      "if",
      "keep",
      "fileinto",
      "addflag",
      "discard",
    ]);

    if (token.value === "require") {
      return parseRequire();
    } else if (token.value === "if") {
      return parseIf();
    } else if (token.value === "keep") {
      return parseKeep();
    } else if (token.value === "fileinto") {
      return parseFileInto();
    } else if (token.value === "addflag") {
      return parseAddFlag();
    } else if (token.value === "discard") {
      return parseDiscard();
    }
  }

  function parseCommands() {
    const commands = [];
    while (token.type === "identifier") {
      commands.push(parseCommand());
    }
    return commands;
  }

  function parseProgram() {
    const commands = parseCommands();
    assertType(["EOF"]);
    return { type: "program", commands };
  }

  return parseProgram();
}

export function evaluate(program, mail) {
  const result = {
    flags: new Set(),
    fileinto: null,
    keep: null,
  };

  function evaluateAddressTest({
    comparator,
    addressPart,
    matchType,
    headerList,
    keyList,
  }) {
    if (comparator) {
      throw new Error(`:comparator is not supported yet`);
    }
    if (addressPart) {
      throw new Error(`:${addressPart.addressPart} is not supported yet`);
    }

    const mt = matchType ? matchType.matchType : "is";
    const tester = {
      is: (a, b) => a.toLowerCase() == b.toLowerCase(),
    }[mt];

    if (!tester) {
      throw new Error(`:${mt} is not supported yet`);
    }

    return headerList.values.some((header) => {
      const values = mail.headers
        .get(header.value.toLowerCase())
        .value.map((v) => v.address);
      return keyList.values.some((key) => {
        return values.some((v) => {
          const res = tester(v, key.value);
          evalLog(
            `Checking address '${header.value}': '${v}' ${mt} '${key.value}' = ${res}`
          );
          return res;
        });
      });
    });
  }

  function evaluateHeaderTest({ comparator, matchType, headerNames, keyList }) {
    if (comparator) {
      throw new Error(`:comparator is not supported yet`);
    }

    const mt = matchType ? matchType.matchType : "is";
    const tester = {
      contains: (a, b) => a.toLowerCase().includes(b.toLowerCase()),
    }[mt];

    if (!tester) {
      throw new Error(`:${mt} is not supported yet`);
    }

    return headerNames.values.some((header) => {
      let values = mail.headers.get(header.value.toLowerCase());

      if (!Array.isArray(values)) {
        values = [values];
      }

      return keyList.values.some((key) => {
        return values.some((v) => {
          const res = tester(v, key.value);
          evalLog(
            `Checking header '${header.value}': '${v}' ${mt} '${key.value}' = ${res}`
          );
          return res;
        });
      });
    });
  }

  function evaluateTest(test) {
    switch (test.type) {
      case "anyof":
        return test.tests.some((t) => evaluateTest(t));
      case "allof":
        return test.tests.every((t) => evaluateTest(t));
      case "address_test":
        return evaluateAddressTest(test);
      case "header_test":
        return evaluateHeaderTest(test);
      default:
        throw new Error(`Uknown test ${test.type}`);
    }
  }

  function evaluateBlock({ commands }) {
    for (const command of commands) {
      switch (command.type) {
        case "keep":
          evalLog(`Marking to keep`);
          result.keep = true;
          break;
        case "discard":
          evalLog(`Marking to discard`);
          result.keep = false;
          break;
        case "addflag":
          for (const flag of command.listOfFlags.values) {
            evalLog(`Adding flag '${flag.value}'`);
            result.flags.add(flag.value);
          }
          break;
        case "fileinto":
          evalLog(`Setting destination mailbox to '${command.mailbox.value}'`);
          result.fileinto = command.mailbox.value;
          break;
        default:
          throw new Error(`Unknown action ${command.type}`);
      }
    }
  }

  function evaluateIf({ test, block, elseStatement }) {
    const result = evaluateTest(test);
    if (result) {
      evaluateBlock(block);
    } else if (elseStatement.type === "if") {
      evaluateIf(elseStatement);
    } else {
      evaluateBlock(elseStatement);
    }
  }

  for (const command of program.commands) {
    switch (command.type) {
      case "require":
        break;
      case "if":
        evaluateIf(command);
        break;
      default:
        throw new Error(`Unknown command ${command.type}`);
    }
  }

  return result;
}
