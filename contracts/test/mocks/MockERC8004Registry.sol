// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title Minimal ERC-721 stand-in for an ERC-8004 Identity Registry used in tests.
contract MockERC8004Registry is ERC721 {
    constructor() ERC721("ERC8004 Agent Identity", "AGNT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
