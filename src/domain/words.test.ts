import { describe, it, expect } from "vitest";
import { rupeesInWords, wholeInWords } from "./words";

describe("amounts in words", () => {
  it("reads small numbers", () => {
    expect(wholeInWords(0)).toBe("Zero");
    expect(wholeInWords(7)).toBe("Seven");
    expect(wholeInWords(19)).toBe("Nineteen");
    expect(wholeInWords(40)).toBe("Forty");
    expect(wholeInWords(86)).toBe("Eighty Six");
    expect(wholeInWords(105)).toBe("One Hundred Five");
  });
  it("uses lakh and crore, not million", () => {
    expect(wholeInWords(1000)).toBe("One Thousand");
    expect(wholeInWords(22004)).toBe("Twenty Two Thousand Four");
    expect(wholeInWords(100000)).toBe("One Lakh");
    expect(wholeInWords(298545)).toBe("Two Lakh Ninety Eight Thousand Five Hundred Forty Five");
    expect(wholeInWords(10000000)).toBe("One Crore");
    expect(wholeInWords(123456789)).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine"
    );
  });
  it("skips the places that are zero", () => {
    expect(wholeInWords(100005)).toBe("One Lakh Five");
    expect(wholeInWords(20000000)).toBe("Two Crore");
  });
  it("writes a rupee amount the way a receipt does", () => {
    expect(rupeesInWords(22004)).toBe("Rupees Twenty Two Thousand Four Only");
    expect(rupeesInWords(22004.86)).toBe("Rupees Twenty Two Thousand Four And Eighty Six Paise Only");
    expect(rupeesInWords(0.5)).toBe("Rupees Zero And Fifty Paise Only");
    expect(rupeesInWords(0)).toBe("Rupees Zero Only");
  });
  it("rounds to the paisa instead of printing floating-point dust", () => {
    expect(rupeesInWords(0.1 + 0.2)).toBe("Rupees Zero And Thirty Paise Only");
    expect(rupeesInWords(19.999)).toBe("Rupees Twenty Only");
  });
  it("marks a negative amount", () => {
    expect(rupeesInWords(-150)).toBe("Minus Rupees One Hundred Fifty Only");
  });
});
