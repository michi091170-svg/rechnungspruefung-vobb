import { evalExpr, topTerms } from "../src/core";

describe("evalExpr – Aufmaßformeln ohne eval", () => {
  it.each([
    ["12,5*8,4*0,20*2+14,8*6*0,2", 59.76],
    ["4,42 x 9,24 + 7,98 × 1,74", 54.726],
    ["(2+3)*2", 10],
    ["-1,01*2,13+5", 2.849],
    ["10/4", 2.5],
  ])("%s = %s", (f, v) => expect(evalExpr(f)).toBe(v));

  it("liefert null bei leerer Eingabe", () => expect(evalExpr("")).toBeNull());
  it.each(["alert(1)", "2**3", "(1+2", "1/0", "1..2"])("weist %s zurück", f => expect(evalExpr(f)).toBeNaN());
});

describe("topTerms", () => {
  it("trennt Summanden mit Vorzeichen auf oberster Ebene", () => {
    const t = topTerms("12,5*2,75-1,01*2,13-(1+1)*0,5");
    expect(t.map(x => [x.sign, x.text])).toEqual([[1, "12,5*2,75"], [-1, "1,01*2,13"], [-1, "(1+1)*0,5"]]);
  });
});
