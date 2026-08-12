import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

afterEach(() => {
  cleanup();
});

describe("dropdown menu primitives", () => {
  it("keeps interactive items at the mobile touch target floor and compact on desktop", () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <button type="button">Open menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>Default action</DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              Delete item
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>
              Checked choice
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="one">
              <DropdownMenuRadioItem value="one">
                Radio choice
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested action</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const defaultItem = screen.getByRole("menuitem", {
      name: "Default action",
    });
    expect(defaultItem).toHaveClass("min-h-11", "md:min-h-9", "md:py-1.5");

    const destructiveItem = screen.getByRole("menuitem", {
      name: "Delete item",
    });
    expect(destructiveItem).toHaveAttribute("data-variant", "destructive");
    expect(destructiveItem).toHaveClass("min-h-11", "md:min-h-9", "md:py-1.5");

    const checkboxItem = screen.getByRole("menuitemcheckbox", {
      name: "Checked choice",
    });
    expect(checkboxItem).toHaveAttribute("aria-checked", "true");
    expect(checkboxItem).toHaveClass("min-h-11", "md:min-h-9", "md:py-1.5");

    const radioItem = screen.getByRole("menuitemradio", {
      name: "Radio choice",
    });
    expect(radioItem).toHaveAttribute("aria-checked", "true");
    expect(radioItem).toHaveClass("min-h-11", "md:min-h-9", "md:py-1.5");

    const subTrigger = screen.getByRole("menuitem", { name: "More actions" });
    expect(subTrigger).toHaveAttribute("aria-haspopup", "menu");
    expect(subTrigger).toHaveClass("min-h-11", "md:min-h-9", "md:py-1.5");
  });
});
